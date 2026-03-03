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

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Patched" }).click(),
  ]);

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();

  const patchedSource = await fs.readFile(downloadPath ?? "", "utf8");
  expect(patchedSource).toContain('"default": "Updated heading from e2e"');
  expect(patchedSource).toContain('"type": "slide"');
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
