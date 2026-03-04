import { Buffer } from "node:buffer";

import { expect, test, type Page } from "@playwright/test";

import {
  type SupabaseTestUsersContext,
  setupSupabaseAuthTestUsers,
} from "./helpers/supabase-test-users";

let usersContext: SupabaseTestUsersContext | null = null;
const ADMIN_MUTATION_HEADERS = {
  "x-admin-csrf": "1",
  origin: "http://localhost:3000",
};

function encodeObjectPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function loginAs(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/upload/);
}

test.beforeAll(async () => {
  usersContext = await setupSupabaseAuthTestUsers();
});

test.afterAll(async () => {
  if (usersContext) {
    await usersContext.cleanup();
  }
});

test.beforeEach(() => {
  test.skip(!usersContext, "Supabase env values are required for admin e2e scenarios.");
});

test("unauthenticated user is redirected to admin login", async ({ page }) => {
  await page.goto("/admin/upload");
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole("heading", { name: /admin login/i })).toBeVisible();
});

test("unauthenticated request to upload API is rejected", async ({ request }) => {
  const response = await request.post("/api/admin/components", {
    headers: ADMIN_MUTATION_HEADERS,
    multipart: {
      title: "Unauth upload",
      category: "hero",
      thumbnail: {
        name: "preview.png",
        mimeType: "image/png",
        buffer: Buffer.from("png-payload"),
      },
      liquidFile: {
        name: "component.liquid",
        mimeType: "text/plain",
        buffer: Buffer.from("{% schema %}{\"name\":\"Test\"}{% endschema %}"),
      },
    },
  });

  expect(response.status()).toBe(401);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("unauthenticated");
});

test("unauthenticated request to delete API is rejected", async ({ request }) => {
  const response = await request.delete(
    "/api/admin/components?id=11111111-1111-1111-1111-111111111111",
    {
      headers: ADMIN_MUTATION_HEADERS,
    },
  );

  expect(response.status()).toBe(401);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("unauthenticated");
});

test("authenticated non-admin is blocked in UI and API", async ({ page }) => {
  if (!usersContext) {
    return;
  }

  await loginAs(page, usersContext.nonAdminEmail, usersContext.nonAdminPassword);
  await expect(page.getByRole("heading", { name: /admin access required/i })).toBeVisible();

  const response = await page.request.post("/api/admin/components", {
    headers: ADMIN_MUTATION_HEADERS,
    multipart: {
      title: "Blocked upload",
      category: "hero",
      thumbnail: {
        name: "preview.png",
        mimeType: "image/png",
        buffer: Buffer.from("png-payload"),
      },
      liquidFile: {
        name: "component.liquid",
        mimeType: "text/plain",
        buffer: Buffer.from("{% schema %}{\"name\":\"Blocked\"}{% endschema %}"),
      },
    },
  });

  expect(response.status()).toBe(403);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("forbidden");

  const deleteResponse = await page.request.delete(
    "/api/admin/components?id=11111111-1111-1111-1111-111111111111",
    {
      headers: ADMIN_MUTATION_HEADERS,
    },
  );
  expect(deleteResponse.status()).toBe(403);
  const deleteBody = (await deleteResponse.json()) as { error?: { code?: string } };
  expect(deleteBody.error?.code).toBe("forbidden");
});

test("admin upload succeeds and persists storage + db paths", async ({ page }) => {
  if (!usersContext) {
    return;
  }

  await loginAs(page, usersContext.adminEmail, usersContext.adminPassword);
  await expect(page.getByRole("heading", { name: /component admin panel/i })).toBeVisible();

  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/components") && response.request().method() === "POST",
  );

  await page.getByLabel("Title").fill("E2E Hero");
  await page.getByLabel("Category").fill("Hero");
  await page.setInputFiles("#thumbnail", {
    name: "preview.png",
    mimeType: "image/png",
    buffer: Buffer.from("png-payload"),
  });
  await page.setInputFiles("#liquidFile", {
    name: "component.liquid",
    mimeType: "text/plain",
    buffer: Buffer.from("{% schema %}{\"name\":\"E2E Hero\"}{% endschema %}"),
  });
  await page.getByRole("button", { name: /upload component/i }).click();

  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);

  const uploadBody = (await uploadResponse.json()) as {
    requestId: string;
    component: {
      id: string;
      title: string;
      category: string;
      thumbnail_path: string;
      file_path: string;
    };
  };

  await expect(page.getByText(/upload succeeded/i)).toBeVisible();

  const componentId = uploadBody.component.id;
  const thumbnailPath = uploadBody.component.thumbnail_path;
  const liquidPath = uploadBody.component.file_path;

  try {
    const { data: dbRowRaw, error: dbError } = await usersContext.serviceClient
      .from("shopify_components")
      .select("id, title, category, thumbnail_path, file_path")
      .eq("id", componentId)
      .single();
    const dbRow = dbRowRaw as
      | {
          id: string;
          title: string;
          category: string;
          thumbnail_path: string;
          file_path: string;
        }
      | null;

    expect(dbError).toBeNull();
    expect(dbRow?.title).toBe("E2E Hero");
    expect(dbRow?.category).toBe("hero");
    expect(dbRow?.thumbnail_path).toBe(thumbnailPath);
    expect(dbRow?.file_path).toBe(liquidPath);

    const { data: thumbnailPublicUrl } = usersContext.serviceClient.storage
      .from("component-thumbnails")
      .getPublicUrl(thumbnailPath);

    const thumbnailResponse = await fetch(thumbnailPublicUrl.publicUrl);
    expect(thumbnailResponse.status).toBe(200);

    const liquidPublicUrl = `${usersContext.supabaseUrl}/storage/v1/object/public/liquid-files/${encodeObjectPath(
      liquidPath,
    )}`;
    const liquidResponse = await fetch(liquidPublicUrl);
    expect(liquidResponse.status).toBe(200);

    const listResponse = await page.request.get("/api/admin/components");
    expect(listResponse.status()).toBe(200);
    const listBody = (await listResponse.json()) as {
      requestId: string;
      components: Array<{ id: string }>;
    };
    expect(listBody.components.some((component) => component.id === componentId)).toBe(true);

    const deleteResponse = await page.request.delete(
      `/api/admin/components?id=${encodeURIComponent(componentId)}`,
      {
        headers: ADMIN_MUTATION_HEADERS,
      },
    );
    expect(deleteResponse.status()).toBe(200);

    const { data: deletedRowRaw, error: deletedRowError } = await usersContext.serviceClient
      .from("shopify_components")
      .select("id")
      .eq("id", componentId)
      .maybeSingle();

    expect(deletedRowError).toBeNull();
    expect(deletedRowRaw).toBeNull();

    const { data: deletedThumbnail, error: deletedThumbnailError } = await usersContext.serviceClient.storage
      .from("component-thumbnails")
      .download(thumbnailPath);
    expect(deletedThumbnail).toBeNull();
    expect(deletedThumbnailError).not.toBeNull();

    const { data: deletedLiquid, error: deletedLiquidError } = await usersContext.serviceClient.storage
      .from("liquid-files")
      .download(liquidPath);
    expect(deletedLiquid).toBeNull();
    expect(deletedLiquidError).not.toBeNull();
  } finally {
    await usersContext.serviceClient.from("shopify_components").delete().eq("id", componentId);
    await usersContext.serviceClient.storage.from("component-thumbnails").remove([thumbnailPath]);
    await usersContext.serviceClient.storage.from("liquid-files").remove([liquidPath]);
  }
});

test("admin upload rejects invalid file types with 400", async ({ page }) => {
  if (!usersContext) {
    return;
  }

  await loginAs(page, usersContext.adminEmail, usersContext.adminPassword);

  const invalidThumbnailResponse = await page.request.post("/api/admin/components", {
    headers: ADMIN_MUTATION_HEADERS,
    multipart: {
      title: "Invalid thumb",
      category: "hero",
      thumbnail: {
        name: "preview.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from("<svg />"),
      },
      liquidFile: {
        name: "component.liquid",
        mimeType: "text/plain",
        buffer: Buffer.from("{% schema %}{\"name\":\"Valid\"}{% endschema %}"),
      },
    },
  });

  expect(invalidThumbnailResponse.status()).toBe(400);
  const invalidThumbnailBody = (await invalidThumbnailResponse.json()) as {
    error?: { code?: string };
  };
  expect(invalidThumbnailBody.error?.code).toBe("validation_failed");

  const invalidLiquidResponse = await page.request.post("/api/admin/components", {
    headers: ADMIN_MUTATION_HEADERS,
    multipart: {
      title: "Invalid liquid",
      category: "hero",
      thumbnail: {
        name: "preview.png",
        mimeType: "image/png",
        buffer: Buffer.from("png-payload"),
      },
      liquidFile: {
        name: "component.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("invalid extension"),
      },
    },
  });

  expect(invalidLiquidResponse.status()).toBe(400);
  const invalidLiquidBody = (await invalidLiquidResponse.json()) as {
    error?: { code?: string };
  };
  expect(invalidLiquidBody.error?.code).toBe("validation_failed");
});
