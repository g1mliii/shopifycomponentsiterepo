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

async function loginAs(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/adminupload/);
}

async function generateHighResolutionVideoThumbnail(page: Page): Promise<{
  buffer: Buffer;
  mimeType: string;
  size: number;
}> {
  const payload = await page.evaluate(async () => {
    const mimeTypeCandidates = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const mimeType = mimeTypeCandidates.find((candidate) =>
      typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function"
        ? MediaRecorder.isTypeSupported(candidate)
        : false,
    ) ?? "video/webm";

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
    });
    const chunks: Blob[] = [];

    const blobPromise = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        resolve(new Blob(chunks, { type: mimeType }));
      }, { once: true });
      recorder.addEventListener("error", () => {
        reject(new Error("Video generation failed."));
      }, { once: true });
    });

    let frame = 0;
    const totalFrames = 90;
    const drawFrame = () => {
      const hue = (frame * 11) % 360;
      context.fillStyle = `hsl(${hue} 90% 60%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < 90; index += 1) {
        context.fillStyle = `hsla(${(hue + index * 7) % 360} 95% 55% / 0.55)`;
        context.fillRect(
          (index * 97 + frame * 19) % canvas.width,
          (index * 53 + frame * 31) % canvas.height,
          120 + (index % 5) * 30,
          70 + (index % 4) * 25,
        );
      }
      context.fillStyle = "#ffffff";
      context.fillRect(120 + (frame * 9) % 720, 110, 280, 420);
      context.fillStyle = "#111111";
      context.font = "bold 84px sans-serif";
      context.fillText(`Frame ${frame + 1}`, 120, 640);
    };

    recorder.start(250);

    await new Promise<void>((resolve) => {
      const intervalId = window.setInterval(() => {
        drawFrame();
        frame += 1;

        if (frame >= totalFrames) {
          window.clearInterval(intervalId);
          recorder.stop();
          stream.getTracks().forEach((track) => track.stop());
          resolve();
        }
      }, 1000 / 30);
    });

    const blob = await blobPromise;
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return {
      base64: btoa(binary),
      mimeType: (blob.type || mimeType).split(";")[0] || "video/webm",
      size: blob.size,
    };
  });

  return {
    buffer: Buffer.from(payload.base64, "base64"),
    mimeType: payload.mimeType,
    size: payload.size,
  };
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
  await page.goto("/adminupload");
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

test("unauthenticated request to thumbnail update API is rejected", async ({ request }) => {
  const response = await request.patch("/api/admin/components", {
    headers: ADMIN_MUTATION_HEADERS,
    multipart: {
      id: "11111111-1111-1111-1111-111111111111",
      thumbnail: {
        name: "preview.png",
        mimeType: "image/png",
        buffer: Buffer.from("png-payload"),
      },
    },
  });

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

  const patchResponse = await page.request.patch("/api/admin/components", {
    headers: ADMIN_MUTATION_HEADERS,
    multipart: {
      id: "11111111-1111-1111-1111-111111111111",
      thumbnail: {
        name: "preview.png",
        mimeType: "image/png",
        buffer: Buffer.from("png-payload"),
      },
    },
  });

  expect(patchResponse.status()).toBe(403);
  const patchBody = (await patchResponse.json()) as { error?: { code?: string } };
  expect(patchBody.error?.code).toBe("forbidden");
});

test("admin upload preview supports scroll scrubbing and iframe hover interactions before submit", async ({ page }) => {
  if (!usersContext) {
    return;
  }

  await loginAs(page, usersContext.adminEmail, usersContext.adminPassword);
  await expect(page.getByRole("heading", { name: /component admin panel/i })).toBeVisible();

  await page.setInputFiles("#liquidFile", {
    name: "interactive-scroll.liquid",
    mimeType: "text/plain",
    buffer: Buffer.from(INTERACTIVE_SCROLL_LIQUID_SOURCE),
  });

  const scrollScrubber = page.getByLabel("Scroll Progress");
  await expect(scrollScrubber).toBeEnabled();
  await expect(page.getByTestId("sandbox-schema-header")).toContainText("Motion");
  await expect(page.getByTestId("sandbox-schema-paragraph")).toContainText("Interactive scroll content should stay inside the preview frame.");

  const previewFrame = page.frameLocator('iframe[title="Component preview"]');
  await expect(previewFrame.locator("[data-scroll-readout]")).toHaveText("0%");

  await scrollScrubber.evaluate((input) => {
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Scroll scrubber was not an input element.");
    }

    input.value = "72";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(scrollScrubber).toHaveValue("72");

  const hoverProbe = previewFrame.getByRole("button", { name: "Hover probe" });
  const beforeHoverColor = await hoverProbe.evaluate((element) => getComputedStyle(element).backgroundColor);
  await hoverProbe.hover();
  await expect.poll(async () => {
    return hoverProbe.evaluate((element) => getComputedStyle(element).backgroundColor);
  }).not.toBe(beforeHoverColor);
});

test("admin upload works without a thumbnail and can add a video thumbnail later from the admin panel", async ({ page }) => {
  if (!usersContext) {
    return;
  }

  test.setTimeout(60_000);

  await loginAs(page, usersContext.adminEmail, usersContext.adminPassword);
  await expect(page.getByRole("heading", { name: /component admin panel/i })).toBeVisible();

  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/components") && response.request().method() === "POST",
  );

  await page.getByLabel("Title").fill("E2E Hero");
  await page.getByLabel("Category").fill("Hero");
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
      thumbnail_path: string | null;
      file_path: string;
    };
  };

  await expect(page.getByText(/upload succeeded/i)).toBeVisible();

  const componentId = uploadBody.component.id;
  const thumbnailPath = uploadBody.component.thumbnail_path;
  const liquidPath = uploadBody.component.file_path;
  let updatedThumbnailPath: string | null = null;

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
          thumbnail_path: string | null;
          file_path: string;
        }
      | null;

    expect(dbError).toBeNull();
    expect(dbRow?.title).toBe("E2E Hero");
    expect(dbRow?.category).toBe("hero");
    expect(thumbnailPath).toBeNull();
    expect(dbRow?.thumbnail_path).toBeNull();
    expect(dbRow?.file_path).toBe(liquidPath);

    const downloadRedirectResponse = await page.request.get(
      `/api/components/${encodeURIComponent(componentId)}/download`,
      {
        maxRedirects: 0,
      },
    );
    expect(downloadRedirectResponse.status()).toBe(302);
    expect(downloadRedirectResponse.headers().location).toContain("/storage/v1/object/sign/liquid-files/");

    const listResponse = await page.request.get("/api/admin/components");
    expect(listResponse.status()).toBe(200);
    const listBody = (await listResponse.json()) as {
      requestId: string;
      components: Array<{ id: string }>;
    };
    expect(listBody.components.some((component) => component.id === componentId)).toBe(true);

    const componentListItem = page
      .locator("li")
      .filter({ has: page.getByText("E2E Hero", { exact: true }) })
      .first();
    const thumbnailUpdateResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/components") && response.request().method() === "PATCH",
    );

    await componentListItem.locator(`input[id="thumbnail-update-${componentId}"]`).setInputFiles({
      name: "preview.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("mock-mp4-video-content"),
    });
    await componentListItem.getByRole("button", { name: /add thumbnail/i }).click();

    const thumbnailUpdateResponse = await thumbnailUpdateResponsePromise;
    expect(thumbnailUpdateResponse.status()).toBe(200);

    const thumbnailUpdateBody = (await thumbnailUpdateResponse.json()) as {
      requestId: string;
      component: {
        id: string;
        thumbnail_path: string | null;
      };
    };

    updatedThumbnailPath = thumbnailUpdateBody.component.thumbnail_path;
    expect(updatedThumbnailPath).not.toBeNull();
    expect(updatedThumbnailPath).toMatch(/\.mp4$/);

    const { data: updatedDbRowRaw, error: updatedDbError } = await usersContext.serviceClient
      .from("shopify_components")
      .select("thumbnail_path")
      .eq("id", componentId)
      .single();

    expect(updatedDbError).toBeNull();
    expect((updatedDbRowRaw as { thumbnail_path: string | null } | null)?.thumbnail_path).toBe(updatedThumbnailPath);

    if (!updatedThumbnailPath) {
      throw new Error("Expected thumbnail path to be populated after update.");
    }

    const { data: thumbnailPublicUrl } = usersContext.serviceClient.storage
      .from("component-thumbnails")
      .getPublicUrl(updatedThumbnailPath);

    const thumbnailResponse = await fetch(thumbnailPublicUrl.publicUrl);
    expect(thumbnailResponse.status).toBe(200);

    const publicListResponse = await page.request.get(`/api/components?query=${encodeURIComponent("E2E Hero")}`);
    expect(publicListResponse.status()).toBe(200);
    const publicListBody = (await publicListResponse.json()) as {
      components: Array<{
        id: string;
        media_kind: string;
        thumbnail_url: string | null;
      }>;
    };
    const publicComponent = publicListBody.components.find((component) => component.id === componentId) ?? null;
    expect(publicComponent?.media_kind).toBe("video");
    expect(publicComponent?.thumbnail_url).toBeTruthy();

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

    if (updatedThumbnailPath) {
      const { data: deletedThumbnail, error: deletedThumbnailError } = await usersContext.serviceClient.storage
        .from("component-thumbnails")
        .download(updatedThumbnailPath);
      expect(deletedThumbnail).toBeNull();
      expect(deletedThumbnailError).not.toBeNull();
    }

    const { data: deletedLiquid, error: deletedLiquidError } = await usersContext.serviceClient.storage
      .from("liquid-files")
      .download(liquidPath);
    expect(deletedLiquid).toBeNull();
    expect(deletedLiquidError).not.toBeNull();
  } finally {
    await usersContext.serviceClient.from("shopify_components").delete().eq("id", componentId);
    if (thumbnailPath) {
      await usersContext.serviceClient.storage.from("component-thumbnails").remove([thumbnailPath]);
    }
    if (updatedThumbnailPath) {
      await usersContext.serviceClient.storage.from("component-thumbnails").remove([updatedThumbnailPath]);
    }
    await usersContext.serviceClient.storage.from("liquid-files").remove([liquidPath]);
  }
});

test("admin later video thumbnail is compressed before upload", async ({ page }) => {
  if (!usersContext) {
    return;
  }

  await loginAs(page, usersContext.adminEmail, usersContext.adminPassword);
  await expect(page.getByRole("heading", { name: /component admin panel/i })).toBeVisible();

  const generatedVideo = await generateHighResolutionVideoThumbnail(page);
  expect(generatedVideo.size).toBeGreaterThan(300_000);

  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/components") && response.request().method() === "POST",
  );

  await page.getByLabel("Title").fill("Video Compression Check");
  await page.getByLabel("Category").fill("Hero");
  await page.setInputFiles("#liquidFile", {
    name: "component.liquid",
    mimeType: "text/plain",
    buffer: Buffer.from("{% schema %}{\"name\":\"Video Compression Check\"}{% endschema %}"),
  });
  await page.getByRole("button", { name: /upload component/i }).click();

  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  const uploadBody = (await uploadResponse.json()) as {
    component: {
      id: string;
      file_path: string;
      thumbnail_path: string | null;
    };
  };

  const componentId = uploadBody.component.id;
  const liquidPath = uploadBody.component.file_path;
  let updatedThumbnailPath: string | null = null;

  try {
    const componentListItem = page
      .locator("li")
      .filter({ has: page.getByText("Video Compression Check", { exact: true }) })
      .first();
    const thumbnailUpdateResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/components") && response.request().method() === "PATCH",
    );

    await componentListItem.locator(`input[id="thumbnail-update-${componentId}"]`).setInputFiles({
      name: "large-preview.webm",
      mimeType: generatedVideo.mimeType,
      buffer: generatedVideo.buffer,
    });
    await componentListItem.getByRole("button", { name: /add thumbnail/i }).click();

    const thumbnailUpdateResponse = await thumbnailUpdateResponsePromise;
    expect(thumbnailUpdateResponse.status()).toBe(200);

    const thumbnailUpdateBody = (await thumbnailUpdateResponse.json()) as {
      component: {
        thumbnail_path: string | null;
      };
    };

    updatedThumbnailPath = thumbnailUpdateBody.component.thumbnail_path;
    expect(updatedThumbnailPath).not.toBeNull();

    if (!updatedThumbnailPath) {
      throw new Error("Expected thumbnail path to be populated after video update.");
    }

    const { data: storedVideo, error: storedVideoError } = await usersContext.serviceClient.storage
      .from("component-thumbnails")
      .download(updatedThumbnailPath);

    expect(storedVideoError).toBeNull();
    expect(storedVideo).not.toBeNull();
    expect(storedVideo?.size ?? 0).toBeLessThan(generatedVideo.size);
  } finally {
    const deleteResponse = await page.request.delete(
      `/api/admin/components?id=${encodeURIComponent(componentId)}`,
      {
        headers: ADMIN_MUTATION_HEADERS,
      },
    );
    expect(deleteResponse.status()).toBe(200);

    if (updatedThumbnailPath) {
      await usersContext.serviceClient.storage.from("component-thumbnails").remove([updatedThumbnailPath]);
    }

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
