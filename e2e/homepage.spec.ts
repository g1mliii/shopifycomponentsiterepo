import { expect, test } from "@playwright/test";

const MOCK_QUERY = "filter-me";
const MOCK_COMPONENT_TITLE = "Injected component";

test("homepage query URL hydrates results from the public components API", async ({ page }) => {
  await page.route("**/api/components**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("query") !== MOCK_QUERY) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        components: [
          {
            id: "mock-component",
            title: MOCK_COMPONENT_TITLE,
            category: "mock",
            thumbnail_path: "mock/component.png",
            created_at: "2026-01-01T00:00:00.000Z",
            thumbnail_url: "/favicon.ico",
            media_kind: "image",
          },
        ],
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1,
        query: MOCK_QUERY,
        category: null,
        categories: ["mock"],
        requestId: "mock-request-id",
      }),
    });
  });

  await page.goto(`/?query=${encodeURIComponent(MOCK_QUERY)}`);
  await expect(page.getByText(MOCK_COMPONENT_TITLE)).toBeVisible();
});

test("homepage renders a safe placeholder when a component has no thumbnail yet", async ({ page }) => {
  await page.route("**/api/components**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("query") !== MOCK_QUERY) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        components: [
          {
            id: "mock-component-no-thumbnail",
            title: "Needs thumbnail later",
            category: "mock",
            thumbnail_path: null,
            created_at: "2026-01-01T00:00:00.000Z",
            thumbnail_url: null,
            media_kind: "missing",
          },
        ],
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1,
        query: MOCK_QUERY,
        category: null,
        categories: ["mock"],
        requestId: "mock-request-id",
      }),
    });
  });

  await page.goto(`/?query=${encodeURIComponent(MOCK_QUERY)}`);
  await expect(page.getByText("Needs thumbnail later")).toBeVisible();
  await expect(page.getByText("Thumbnail pending")).toBeVisible();
});
