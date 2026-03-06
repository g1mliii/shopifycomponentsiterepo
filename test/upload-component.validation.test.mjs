import assert from "node:assert/strict";
import test from "node:test";

import {
  getFileExtension,
  normalizeCategory,
  validateUploadComponentInput,
  validationLimits,
} from "../src/lib/validation/upload-component.ts";

function makeFile({ name, type, size }) {
  return new File([new Uint8Array(size)], name, { type });
}

test("normalizeCategory is deterministic and idempotent", () => {
  const once = normalizeCategory("  Hero Banner  ");
  const twice = normalizeCategory(once);

  assert.equal(once, "hero banner");
  assert.equal(twice, once);
});

test("getFileExtension handles lowercasing and no-extension values", () => {
  assert.equal(getFileExtension("thumbnail.PNG"), ".png");
  assert.equal(getFileExtension("component.liquid"), ".liquid");
  assert.equal(getFileExtension("no-extension"), "");
});

test("validateUploadComponentInput accepts valid payload and normalizes text", () => {
  const result = validateUploadComponentInput({
    title: "  Hero CTA  ",
    category: "  Promo  ",
    thumbnailFile: makeFile({
      name: "preview.jpg",
      type: "image/jpeg",
      size: 1024,
    }),
    liquidFile: makeFile({
      name: "hero.liquid",
      type: "text/plain",
      size: 1024,
    }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.data.title, "Hero CTA");
  assert.equal(result.data.category, "promo");
  assert.equal(result.data.thumbnailExtension, ".jpg");
  assert.equal(result.data.liquidExtension, ".liquid");
});

test("validateUploadComponentInput accepts uploads without a thumbnail", () => {
  const result = validateUploadComponentInput({
    title: "  Hero CTA  ",
    category: "  Promo  ",
    thumbnailFile: null,
    liquidFile: makeFile({
      name: "hero.liquid",
      type: "text/plain",
      size: 1024,
    }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.data.thumbnailFile, null);
  assert.equal(result.data.thumbnailMimeType, null);
  assert.equal(result.data.thumbnailExtension, null);
});

test("validateUploadComponentInput rejects invalid thumbnail MIME/extension matrix", () => {
  const result = validateUploadComponentInput({
    title: "Card",
    category: "promo",
    thumbnailFile: makeFile({
      name: "preview.png",
      type: "video/mp4",
      size: 1000,
    }),
    liquidFile: makeFile({
      name: "hero.liquid",
      type: "text/plain",
      size: 1000,
    }),
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(
    result.issues.some((issue) => issue.field === "thumbnailFile" && issue.code === "invalid_extension"),
    true,
  );
});

test("validateUploadComponentInput rejects non-.liquid files", () => {
  const result = validateUploadComponentInput({
    title: "Card",
    category: "promo",
    thumbnailFile: makeFile({
      name: "preview.webp",
      type: "image/webp",
      size: 1000,
    }),
    liquidFile: makeFile({
      name: "hero.txt",
      type: "text/plain",
      size: 1000,
    }),
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(
    result.issues.some((issue) => issue.field === "liquidFile" && issue.code === "invalid_extension"),
    true,
  );
});

test("validateUploadComponentInput returns file_too_large for oversized files", () => {
  const result = validateUploadComponentInput({
    title: "Card",
    category: "promo",
    thumbnailFile: makeFile({
      name: "preview.mp4",
      type: "video/mp4",
      size: validationLimits.THUMBNAIL_MAX_BYTES + 1,
    }),
    liquidFile: makeFile({
      name: "hero.liquid",
      type: "text/plain",
      size: validationLimits.LIQUID_MAX_BYTES + 1,
    }),
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(
    result.issues.filter((issue) => issue.code === "file_too_large").length >= 2,
    true,
  );
});
