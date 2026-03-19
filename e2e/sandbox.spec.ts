import fs from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { setupSandboxFixture, type SandboxFixtureContext } from "./helpers/sandbox-fixtures";

let fixture: SandboxFixtureContext | null = null;
let interactiveFixture: SandboxFixtureContext | null = null;

const INTERACTIVE_SCROLL_LIQUID_SOURCE = `{% assign title = section.settings.title %}
<style>
  .scroll-probe-shell {
    height: 320vh;
    background:
      linear-gradient(180deg, #f6f0e8 0%, #efe4d5 28%, #d9c7ae 62%, #c6aa86 100%);
  }

  .scroll-probe-stage {
    position: sticky;
    top: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .scroll-probe-card {
    display: grid;
    gap: 16px;
    width: min(100%, 26rem);
    padding: 24px;
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.84);
    box-shadow: 0 18px 60px rgba(78, 59, 34, 0.18);
    text-align: center;
  }

  .hover-probe {
    border: 0;
    border-radius: 999px;
    padding: 14px 18px;
    font: inherit;
    color: #2e2418;
    background: #e0d1bb;
    transition: background-color 120ms linear, color 120ms linear;
  }

  .hover-probe:hover {
    color: #ffffff;
    background: #456b57;
  }
</style>

<section class="scroll-probe-shell">
  <div class="scroll-probe-stage">
    <div class="scroll-probe-card">
      <p>{{ title }}</p>
      <strong data-scroll-readout data-progress="0">0%</strong>
      <button type="button" class="hover-probe">Hover probe</button>
    </div>
  </div>
</section>

<script>
  (function () {
    var readout = document.querySelector("[data-scroll-readout]");

    function update() {
      var maxScrollTop = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      var progress = Math.round((window.scrollY / maxScrollTop) * 100);
      if (!readout) {
        return;
      }

      readout.textContent = progress + "%";
      readout.setAttribute("data-progress", String(progress));
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
  })();
</script>

{% schema %}
{
  "name": "Interactive Scroll Fixture",
  "settings": [
    { "type": "header", "content": "Motion" },
    { "type": "paragraph", "content": "Interactive scroll content should stay inside the preview frame." },
    { "type": "text", "id": "title", "label": "Title", "default": "Interactive preview probe" }
  ],
  "presets": [
    {
      "name": "Interactive Scroll Fixture"
    }
  ]
}
{% endschema %}`;

function extractSchemaFromLiquidSource(source: string): Record<string, unknown> {
  const match = source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i);
  if (!match || typeof match[1] !== "string") {
    throw new Error("Downloaded Liquid source does not contain a schema block.");
  }

  return JSON.parse(match[1]) as Record<string, unknown>;
}

test.beforeAll(async () => {
  fixture = await setupSandboxFixture();
  interactiveFixture = await setupSandboxFixture({
    liquidSource: INTERACTIVE_SCROLL_LIQUID_SOURCE,
  });
});

test.afterAll(async () => {
  if (fixture) {
    await fixture.cleanup();
  }
  if (interactiveFixture) {
    await interactiveFixture.cleanup();
  }
});

test.beforeEach(() => {
  test.skip(!fixture, "Supabase env values are required for sandbox e2e scenarios.");
});

test("sandbox renders live preview and downloads patched liquid", async ({ page }) => {
  if (!fixture) {
    return;
  }

  await page.goto(`/components/${encodeURIComponent(fixture.componentId)}/sandbox`);
  await expect(page.getByRole("heading", { name: "Liquid Sandbox" })).toBeVisible();
  await expect(page.locator('iframe[title="Component preview"]')).toBeVisible();
  await expect(page.locator('iframe[title="Component preview"]')).toHaveAttribute("sandbox", "allow-scripts");
  const layoutMetrics = await page.evaluate(() => {
    const main = document.querySelector("main");
    const previewFrame = document.querySelector('iframe[title="Component preview"]');
    const previewContainer = previewFrame?.parentElement;
    if (!main || !previewContainer) {
      return null;
    }

    const viewportHeight = window.innerHeight;
    const previewRect = previewContainer.getBoundingClientRect();

    return {
      pageOverflowPx: Math.max(0, document.documentElement.scrollHeight - viewportHeight),
      previewHeight: previewRect.height,
      previewBottomGapPx: Math.abs(viewportHeight - previewRect.bottom),
    };
  });

  expect(layoutMetrics).not.toBeNull();
  expect(layoutMetrics?.pageOverflowPx ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
  expect(layoutMetrics?.previewHeight ?? 0).toBeGreaterThanOrEqual(240);
  expect(layoutMetrics?.previewBottomGapPx ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(2);

  const colorSchemeSelect = page.getByLabel("Color Scheme");
  await expect(colorSchemeSelect).toBeVisible();
  await expect(colorSchemeSelect.locator("option")).toHaveCount(8);
  await colorSchemeSelect.selectOption("scheme_2");
  await expect(colorSchemeSelect).toHaveValue("scheme_2");

  const sectionHeadingInput = page.getByLabel("Heading").first();
  await sectionHeadingInput.fill("Updated heading from e2e");

  const previewFrame = page.frameLocator('iframe[title="Component preview"]');
  await expect(previewFrame.locator("h2")).toContainText("Updated heading from e2e");

  const splitter = page.getByRole("separator", { name: "Resize editor and preview panels" });
  await splitter.focus();
  const beforeSplit = await splitter.evaluate((node) =>
    node.parentElement?.style.getPropertyValue("--sandbox-left-pane"),
  );
  await page.keyboard.press("ArrowRight");
  const afterSplit = await splitter.evaluate((node) =>
    node.parentElement?.style.getPropertyValue("--sandbox-left-pane"),
  );
  expect(afterSplit).not.toBe(beforeSplit);

  await page.getByRole("button", { name: "Add block" }).click();
  await page.getByRole("button", { name: "Add block" }).click();
  await expect(page.getByText(/Block 3:/)).toBeVisible();
  await expect(page.getByText(/Block 4:/)).toBeVisible();
  await expect(previewFrame.locator(".slide-item")).toHaveCount(4);
  await expect(previewFrame.locator(".slide-item").last()).toContainText("Slide title");

  const fourthBlockCard = page.locator('[data-testid="sandbox-block-card"]').nth(3);
  await fourthBlockCard.getByRole("button", { name: "Collapse" }).click();
  await expect(fourthBlockCard.getByText("Settings hidden. Expand to edit this block.")).toBeVisible();
  await fourthBlockCard.getByRole("button", { name: "Expand" }).click();
  await expect(fourthBlockCard.getByTestId("sandbox-block-settings")).toBeVisible();
  await expect(fourthBlockCard.getByRole("button", { name: "Delete" })).toBeVisible();

  const blockActionFitsWithinCard = await fourthBlockCard.evaluate((card) => {
    const actions = card.querySelector('[data-testid="sandbox-block-actions"]');
    if (!actions) {
      return null;
    }

    const cardRect = card.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      fitsHorizontally: actionsRect.right <= cardRect.right + 1,
      startsWithinCard: actionsRect.left >= cardRect.left - 1,
    };
  });

  expect(blockActionFitsWithinCard).not.toBeNull();
  expect(blockActionFitsWithinCard?.fitsHorizontally ?? false).toBeTruthy();
  expect(blockActionFitsWithinCard?.startsWithinCard ?? false).toBeTruthy();

  const defaultMaxWidth = await page.evaluate(() => getComputedStyle(document.querySelector("main")!).maxWidth);
  expect(defaultMaxWidth).toBe("none");

  await page.getByRole("button", { name: "Contained Width" }).click();
  await expect(page.getByRole("button", { name: "Fill Width" })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Resize editor and preview panels" })).toHaveCount(1);
  await expect(page.getByText("Section Settings")).toBeVisible();

  const containedLayoutMetrics = await page.evaluate(() => {
    const main = document.querySelector("main");
    const previewFrame = document.querySelector('iframe[title="Component preview"]');
    const previewContainer = previewFrame?.parentElement;
    if (!main || !previewContainer) {
      return null;
    }

    const mainRect = main.getBoundingClientRect();
    const previewRect = previewContainer.getBoundingClientRect();
    const computedMain = getComputedStyle(main);
    return {
      maxWidth: computedMain.maxWidth,
      previewToMainWidthRatio: mainRect.width > 0 ? previewRect.width / mainRect.width : 0,
    };
  });

  expect(containedLayoutMetrics).not.toBeNull();
  expect(containedLayoutMetrics?.maxWidth).toBe("1500px");
  expect(containedLayoutMetrics?.previewToMainWidthRatio ?? 0).toBeGreaterThanOrEqual(0.35);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Current" }).click(),
  ]);

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();

  const patchedSource = await fs.readFile(downloadPath ?? "", "utf8");
  expect(patchedSource).toContain('"default": "Updated heading from e2e"');
  expect(patchedSource).toContain('"type": "slide"');

  const parsedSchema = extractSchemaFromLiquidSource(patchedSource);
  const presets = parsedSchema.presets;
  expect(Array.isArray(presets)).toBeTruthy();
  const firstPreset = Array.isArray(presets) ? presets[0] : null;
  expect(firstPreset && typeof firstPreset === "object").toBeTruthy();
  const presetBlocks = firstPreset && typeof firstPreset === "object"
    ? (firstPreset as { blocks?: unknown }).blocks
    : null;
  expect(Array.isArray(presetBlocks)).toBeTruthy();
  expect(Array.isArray(presetBlocks) ? presetBlocks.length : 0).toBe(4);
});

test("sandbox stacks workspace on narrow screens", async ({ page }) => {
  if (!fixture) {
    return;
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/components/${encodeURIComponent(fixture.componentId)}/sandbox`);

  await expect(page.getByRole("heading", { name: "Liquid Sandbox" })).toBeVisible();
  await expect(page.getByText("Section Settings")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Resize editor and preview panels" })).toHaveCount(0);

  const mobileLayoutMetrics = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="sandbox-workspace"]');
    const editorPane = document.querySelector('[data-testid="sandbox-editor-pane"]');
    const previewPane = document.querySelector('[data-testid="sandbox-preview-pane"]');
    if (!workspace || !editorPane || !previewPane) {
      return null;
    }

    const workspaceRect = workspace.getBoundingClientRect();
    const editorRect = editorPane.getBoundingClientRect();
    const previewRect = previewPane.getBoundingClientRect();
    const gridTemplateColumns = getComputedStyle(workspace).gridTemplateColumns;
    const columnCount = gridTemplateColumns.trim().split(/\s+/).length;

    return {
      columnCount,
      editorToWorkspaceWidthRatio: workspaceRect.width > 0 ? editorRect.width / workspaceRect.width : 0,
      previewToWorkspaceWidthRatio: workspaceRect.width > 0 ? previewRect.width / workspaceRect.width : 0,
      previewBelowEditor: previewRect.top >= editorRect.bottom - 1,
      pageOverflowXPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });

  expect(mobileLayoutMetrics).not.toBeNull();
  expect(mobileLayoutMetrics?.columnCount ?? Number.POSITIVE_INFINITY).toBe(1);
  expect(mobileLayoutMetrics?.editorToWorkspaceWidthRatio ?? 0).toBeGreaterThanOrEqual(0.95);
  expect(mobileLayoutMetrics?.previewToWorkspaceWidthRatio ?? 0).toBeGreaterThanOrEqual(0.95);
  expect(mobileLayoutMetrics?.previewBelowEditor ?? false).toBeTruthy();
  expect(mobileLayoutMetrics?.pageOverflowXPx ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
});

test("sandbox applies local media preview uploads inside iframe", async ({ page }) => {
  if (!fixture) {
    return;
  }

  await page.goto(`/components/${encodeURIComponent(fixture.componentId)}/sandbox`);
  await expect(page.getByRole("heading", { name: "Liquid Sandbox" })).toBeVisible();

  const localFileInput = page.locator('input[type="file"]').first();
  await localFileInput.setInputFiles({
    name: "sandbox-preview.png",
    mimeType: "image/png",
    buffer: Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00, 0x00, 0xb5,
      0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc,
      0xff, 0x1f, 0x00, 0x03, 0x03, 0x01, 0xff, 0xa5, 0xf9, 0x1f, 0x7d, 0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]),
  });

  const previewFrame = page.frameLocator('iframe[title="Component preview"]');
  const heroPreviewImage = previewFrame.locator("img.hero-preview");
  await expect(heroPreviewImage).toBeVisible();
  await expect(heroPreviewImage).toHaveAttribute("src", /data:image\/png;base64/i);

  const heroImageUrlInput = page.locator('input[id="section:hero_image"]');
  await heroImageUrlInput.fill("hero-image-name");
  await expect(heroPreviewImage).toHaveAttribute("src", /data:image\/png;base64/i);

  await page.getByRole("button", { name: "Clear Local Preview" }).first().click();
  await expect(heroPreviewImage).not.toHaveAttribute("src", /data:image\/png;base64/i);
});

test("sandbox scroll scrubber drives iframe scroll while hover still works", async ({ page }) => {
  if (!interactiveFixture) {
    return;
  }

  await page.goto(`/components/${encodeURIComponent(interactiveFixture.componentId)}/sandbox`);
  await expect(page.getByRole("heading", { name: "Liquid Sandbox" })).toBeVisible();

  const previewFrame = page.frameLocator('iframe[title="Component preview"]');
  const scrollScrubber = page.getByLabel("Scroll Progress");
  await expect(scrollScrubber).toBeEnabled();
  await expect(page.getByTestId("sandbox-schema-header")).toContainText("Motion");
  await expect(page.getByTestId("sandbox-schema-paragraph")).toContainText("Interactive scroll content should stay inside the preview frame.");
  await expect(previewFrame.locator("[data-scroll-readout]")).toHaveText("0%");

  await scrollScrubber.evaluate((input) => {
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Scroll scrubber was not an input element.");
    }

    input.value = "68";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(previewFrame.locator("[data-scroll-readout]")).toHaveAttribute("data-progress", /6\d|7\d|8\d|9\d|100/);

  const hoverProbe = previewFrame.getByRole("button", { name: "Hover probe" });
  const beforeHoverColor = await hoverProbe.evaluate((element) => getComputedStyle(element).backgroundColor);
  await hoverProbe.hover();
  await expect.poll(async () => {
    return hoverProbe.evaluate((element) => getComputedStyle(element).backgroundColor);
  }).not.toBe(beforeHoverColor);

  const previewStage = page.getByTestId("sandbox-preview-stage");
  const iframeElement = page.locator('iframe[title="Component preview"]');
  const iframeBounds = await iframeElement.boundingBox();
  expect(iframeBounds).not.toBeNull();
  await page.mouse.move(
    (iframeBounds?.x ?? 0) + Math.max(24, (iframeBounds?.width ?? 0) / 2),
    (iframeBounds?.y ?? 0) + Math.max(24, Math.min(120, (iframeBounds?.height ?? 0) / 3)),
  );
  await page.mouse.wheel(0, 900);

  await expect.poll(async () => previewStage.evaluate((node) => node.scrollTop)).toBe(0);
  await expect.poll(async () => {
    return previewFrame.locator("[data-scroll-readout]").getAttribute("data-progress");
  }).not.toBe("0");

  await page.getByRole("button", { name: "Reset Scroll" }).click();
  await expect(previewFrame.locator("[data-scroll-readout]")).toHaveText("0%");
});
