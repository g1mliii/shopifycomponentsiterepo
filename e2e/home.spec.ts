import { expect, test } from "@playwright/test";

test("homepage renders", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /to get started, edit the page\.tsx file\./i }),
  ).toBeVisible();
});
