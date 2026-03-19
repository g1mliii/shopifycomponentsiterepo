import { expect, test } from "@playwright/test";

import {
  setupPublicComponentsFixtures,
  type PublicComponentsFixturesContext,
} from "./helpers/public-components-fixtures";

let fixtures: PublicComponentsFixturesContext | null = null;

test.beforeAll(async () => {
  fixtures = await setupPublicComponentsFixtures();
});

test.afterAll(async () => {
  if (fixtures) {
    await fixtures.cleanup();
  }
});

test.beforeEach(() => {
  test.skip(!fixtures, "Supabase env values are required for public gallery e2e scenarios.");
});

test("public gallery shell renders and starter content is removed", async ({ page }) => {
  if (!fixtures) {
    return;
  }

  await page.goto(`/?query=${encodeURIComponent(fixtures.queryToken)}`);

  await expect(page.getByRole("heading", { name: /shopify components/i })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /to get started, edit the page\.tsx file\./i }),
  ).toHaveCount(0);
  await expect(page.locator('[data-testid="public-component-card"]')).toHaveCount(12);
});

test("video thumbnails stay fitted and support explicit preview controls", async ({ page }) => {
  if (!fixtures) {
    return;
  }

  await page.goto(`/?query=${encodeURIComponent(fixtures.queryToken)}`);

  const videoCard = page
    .locator('[data-testid="public-component-card"]')
    .filter({
      has: page.getByRole("heading", { name: fixtures.firstComponentTitle }),
    })
    .first();

  const secondaryCard = page.locator('[data-testid="public-component-card"]').nth(1);
  const videoMedia = videoCard.getByTestId("public-thumbnail-media");
  const previewToggle = videoCard.getByTestId("thumbnail-preview-toggle");

  await expect(videoCard).toBeVisible();
  await expect(videoCard.locator("video")).toHaveCount(0);
  await expect(videoMedia).toHaveAttribute("data-video-hovered", "false");
  await expect(previewToggle).toBeVisible();

  await videoMedia.hover();
  await expect(videoMedia).toHaveAttribute("data-video-hovered", "true");
  await expect(videoCard.locator("video")).toHaveCount(1);

  const sizing = await videoCard.evaluate((card) => {
    const media = card.querySelector('[data-testid="public-thumbnail-media"]');
    const video = media?.querySelector("video");
    if (!media || !video) {
      return null;
    }

    const mediaRect = media.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    return {
      objectFit: getComputedStyle(video).objectFit,
      widthDelta: Math.abs(mediaRect.width - videoRect.width),
      heightDelta: Math.abs(mediaRect.height - videoRect.height),
      widthOverflow: videoRect.width - mediaRect.width,
      heightOverflow: videoRect.height - mediaRect.height,
    };
  });

  expect(sizing).not.toBeNull();
  expect(sizing?.objectFit).toBe("contain");
  expect(sizing?.widthOverflow ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
  expect(sizing?.heightOverflow ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
  expect(
    Math.min(
      sizing?.widthDelta ?? Number.POSITIVE_INFINITY,
      sizing?.heightDelta ?? Number.POSITIVE_INFINITY,
    ),
  ).toBeLessThanOrEqual(1);

  await secondaryCard.getByTestId("public-thumbnail-media").hover();
  await page.getByRole("heading", { name: /shopify components/i }).hover();

  await previewToggle.click();
  await expect(videoMedia).toHaveAttribute("data-video-hovered", "true");
  await expect(previewToggle).toHaveAttribute("aria-pressed", "true");
  await expect(videoCard.locator("video")).toHaveCount(1);

  await previewToggle.click();
  await expect(previewToggle).toHaveAttribute("aria-pressed", "false");
  await expect(videoMedia).toHaveAttribute("data-video-hovered", "false");
  await expect(videoCard.locator("video")).toHaveCount(0);
});

test("pagination is deterministic", async ({ page }) => {
  if (!fixtures) {
    return;
  }

  await page.goto(`/?query=${encodeURIComponent(fixtures.queryToken)}`);

  const cards = page.locator('[data-testid="public-component-card"]');
  await expect(cards).toHaveCount(12);

  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(cards).toHaveCount(1);

  await page.getByRole("link", { name: "Previous" }).click();
  await expect(page).toHaveURL(new RegExp(`query=${fixtures.queryToken}`));
  await expect(cards).toHaveCount(12);
});

test("search and category filters update URL and results", async ({ page }) => {
  if (!fixtures) {
    return;
  }

  await page.goto("/");

  await page.getByRole("searchbox").fill(fixtures.queryToken);
  await page.waitForURL(new RegExp(`query=${fixtures.queryToken}`));
  await expect(page.locator('[data-testid="public-component-card"]')).toHaveCount(12);

  await page.getByLabel("Category").selectOption("hero");
  await page.waitForURL(/category=hero/);
  await expect(page.locator('[data-testid="public-component-card"]')).toHaveCount(7);
});

test("download endpoint returns redirect and applies rate limit", async ({ request }) => {
  if (!fixtures) {
    return;
  }

  const ipNonceA = Math.floor(Math.random() * 200);
  const ipNonceB = Math.floor(Math.random() * 200);
  const successIp = `198.51.${ipNonceA}.${50 + Math.floor(Math.random() * 150)}`;
  const rateLimitedIp = `198.51.${ipNonceB}.${50 + Math.floor(Math.random() * 150)}`;

  const successResponse = await request.get(
    `/api/components/${encodeURIComponent(fixtures.firstComponentId)}/download`,
    {
      headers: {
        "cf-connecting-ip": successIp,
      },
      maxRedirects: 0,
    },
  );

  expect(successResponse.status()).toBe(302);
  expect(successResponse.headers().location).toContain("/storage/v1/object/sign/liquid-files/");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await request.get(`/api/components/${encodeURIComponent(fixtures.firstComponentId)}/download`, {
      headers: {
        "cf-connecting-ip": rateLimitedIp,
      },
      maxRedirects: 0,
    });
  }

  const rateLimitedResponse = await request.get(
    `/api/components/${encodeURIComponent(fixtures.firstComponentId)}/download`,
    {
      headers: {
        "cf-connecting-ip": rateLimitedIp,
      },
      maxRedirects: 0,
    },
  );

  expect(rateLimitedResponse.status()).toBe(429);
  const body = (await rateLimitedResponse.json()) as {
    error?: { code?: string };
  };
  expect(body.error?.code).toBe("download_rate_limited");
});

test("sandbox button opens live Phase 4 sandbox route", async ({ page }) => {
  if (!fixtures) {
    return;
  }

  await page.goto(`/?query=${encodeURIComponent(fixtures.queryToken)}`);
  await page.getByRole("link", { name: "Edit/Preview" }).first().click();

  await expect(page).toHaveURL(/\/components\/.*\/sandbox/);
  await expect(page.getByRole("heading", { name: "Liquid Sandbox" })).toBeVisible();
});
