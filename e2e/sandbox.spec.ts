import fs from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { setupSandboxFixture, type SandboxFixtureContext } from "./helpers/sandbox-fixtures";

let fixture: SandboxFixtureContext | null = null;

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
  await expect(page.getByText(/Block 3:/)).toBeVisible();

  const containedMaxWidth = await page.evaluate(() => getComputedStyle(document.querySelector("main")!).maxWidth);
  expect(containedMaxWidth).toBe("1500px");

  await page.getByRole("button", { name: "Fill Width" }).click();
  await expect(page.getByRole("button", { name: "Contained Width" })).toBeVisible();
  await expect(page.getByRole("separator", { name: "Resize editor and preview panels" })).toHaveCount(1);
  await expect(page.getByText("Section Settings")).toBeVisible();

  const expandedLayoutMetrics = await page.evaluate(() => {
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

  expect(expandedLayoutMetrics).not.toBeNull();
  expect(expandedLayoutMetrics?.maxWidth).toBe("none");
  expect(expandedLayoutMetrics?.previewToMainWidthRatio ?? 0).toBeGreaterThanOrEqual(0.35);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Current" }).click(),
  ]);

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();

  const patchedSource = await fs.readFile(downloadPath ?? "", "utf8");
  expect(patchedSource).toContain('"default": "Updated heading from e2e"');
  expect(patchedSource).toContain('"type": "slide"');
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

test("sandbox revokes local media object URLs when unmounted", async ({ page }) => {
  if (!fixture) {
    return;
  }

  await page.addInitScript(() => {
    const stats = {
      creates: 0,
      revokes: 0,
    };

    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);

    URL.createObjectURL = ((object: Blob | MediaSource) => {
      stats.creates += 1;
      return originalCreateObjectUrl(object);
    }) as typeof URL.createObjectURL;

    URL.revokeObjectURL = ((url: string) => {
      stats.revokes += 1;
      originalRevokeObjectUrl(url);
    }) as typeof URL.revokeObjectURL;

    (window as Window & { __sandboxObjectUrlStats?: typeof stats }).__sandboxObjectUrlStats = stats;
  });

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

  await page.getByRole("link", { name: "Back to Gallery" }).click();
  await expect(page).toHaveURL("/");

  const stats = await page.evaluate(
    () =>
      (window as Window & { __sandboxObjectUrlStats?: { creates: number; revokes: number } })
        .__sandboxObjectUrlStats,
  );

  expect(stats?.creates ?? 0).toBeGreaterThan(0);
  expect(stats?.revokes ?? 0).toBeGreaterThanOrEqual(stats?.creates ?? 0);
});
