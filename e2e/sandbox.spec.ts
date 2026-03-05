import fs from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { setupSandboxFixture, type SandboxFixtureContext } from "./helpers/sandbox-fixtures";

let fixture: SandboxFixtureContext | null = null;

function extractSchemaFromLiquidSource(source: string): Record<string, unknown> {
  const match = source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i);
  if (!match || typeof match[1] !== "string") {
    throw new Error("Downloaded Liquid source does not contain a schema block.");
  }

  return JSON.parse(match[1]) as Record<string, unknown>;
}

test.beforeAll(async () => {
  fixture = await setupSandboxFixture();
});

test.afterAll(async () => {
  if (fixture) {
    await fixture.cleanup();
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
  expect(layoutMetrics?.previewHeight ?? 0).toBeGreaterThanOrEqual(320);
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
