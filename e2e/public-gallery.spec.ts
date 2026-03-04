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

  const successResponse = await request.get(
    `/api/components/${encodeURIComponent(fixtures.firstComponentId)}/download`,
    {
      headers: {
        "x-forwarded-for": "198.51.100.120",
      },
      maxRedirects: 0,
    },
  );

  expect(successResponse.status()).toBe(302);
  expect(successResponse.headers().location).toContain("/storage/v1/object/public/liquid-files/");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await request.get(`/api/components/${encodeURIComponent(fixtures.firstComponentId)}/download`, {
      headers: {
        "x-forwarded-for": "198.51.100.121",
      },
      maxRedirects: 0,
    });
  }

  const rateLimitedResponse = await request.get(
    `/api/components/${encodeURIComponent(fixtures.firstComponentId)}/download`,
    {
      headers: {
        "x-forwarded-for": "198.51.100.121",
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
