import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { applyLiquidPreviewFallbacks } from "../src/lib/liquid/preview-fallbacks.ts";
import { renderLiquidPreview } from "../src/lib/liquid/render.ts";
import { parseLiquidSchema } from "../src/lib/liquid/schema-parse.ts";
import { buildInitialEditorState } from "../src/lib/liquid/schema-patch.ts";

const FIXTURE_PATH = path.resolve("test/fixtures/mega-stress-preview-component.liquid");

const source = fs.readFileSync(FIXTURE_PATH, "utf8");

const FALLBACK_TYPES = new Set([
  "article",
  "blog",
  "collection",
  "collection_list",
  "font_picker",
  "image_picker",
  "link_list",
  "metaobject",
  "metaobject_list",
  "page",
  "product",
  "product_list",
  "url",
  "video",
  "video_url",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function assertFallbackShape(type, value, settingPath) {
  switch (type) {
    case "image_picker":
    case "video":
    case "video_url":
    case "url":
      assert.ok(isNonEmptyString(value), `${settingPath} should have non-empty string fallback`);
      return;
    case "collection":
      assert.ok(isRecord(value), `${settingPath} should be object`);
      assert.ok(isNonEmptyString(value.handle), `${settingPath}.handle should be non-empty`);
      assert.ok(Array.isArray(value.products), `${settingPath}.products should be array`);
      assert.ok(value.products.length > 0, `${settingPath}.products should not be empty`);
      return;
    case "product":
    case "article":
    case "blog":
    case "page":
      assert.ok(isRecord(value), `${settingPath} should be object`);
      assert.ok(isNonEmptyString(value.handle), `${settingPath}.handle should be non-empty`);
      return;
    case "collection_list":
    case "product_list":
    case "metaobject_list":
      assert.ok(Array.isArray(value), `${settingPath} should be array`);
      assert.ok(value.length > 0, `${settingPath} should not be empty`);
      return;
    case "metaobject":
      assert.ok(isRecord(value), `${settingPath} should be object`);
      assert.ok(isNonEmptyString(value.type), `${settingPath}.type should be non-empty`);
      assert.ok(isNonEmptyString(value.handle), `${settingPath}.handle should be non-empty`);
      assert.ok(isNonEmptyString(value.id), `${settingPath}.id should be non-empty`);
      return;
    case "link_list":
      assert.ok(isRecord(value), `${settingPath} should be object`);
      assert.ok(isNonEmptyString(value.handle), `${settingPath}.handle should be non-empty`);
      assert.ok(Array.isArray(value.links), `${settingPath}.links should be array`);
      assert.ok(value.links.length > 0, `${settingPath}.links should not be empty`);
      return;
    case "font_picker":
      assert.ok(isRecord(value), `${settingPath} should be object`);
      assert.ok(isNonEmptyString(value.family), `${settingPath}.family should be non-empty`);
      return;
    default:
      return;
  }
}

test("mega fixture: fallback-required section and block settings are all populated", () => {
  const parsed = parseLiquidSchema(source);
  assert.ok(parsed.schema);

  const state = buildInitialEditorState(parsed.schema);
  const fallbackState = applyLiquidPreviewFallbacks(parsed.schema, state);

  for (const setting of parsed.schema.settings) {
    const type = setting.type.toLowerCase();
    if (!FALLBACK_TYPES.has(type)) {
      continue;
    }
    assertFallbackShape(type, fallbackState.sectionSettings[setting.id], `section.settings.${setting.id}`);
  }

  for (const block of fallbackState.blocks) {
    const definition = parsed.schema.blocks.find((entry) => entry.type === block.type);
    if (!definition) {
      continue;
    }

    for (const setting of definition.settings) {
      const type = setting.type.toLowerCase();
      if (!FALLBACK_TYPES.has(type)) {
        continue;
      }
      assertFallbackShape(type, block.settings[setting.id], `block(${block.type}).settings.${setting.id}`);
    }
  }
});

test("mega fixture: renders successfully with fallback state", async () => {
  const parsed = parseLiquidSchema(source);
  assert.ok(parsed.schema);

  const state = buildInitialEditorState(parsed.schema);
  const fallbackState = applyLiquidPreviewFallbacks(parsed.schema, state);
  const result = await renderLiquidPreview(source, fallbackState);

  assert.match(result.html, /Simulated Resource Inputs/);
  assert.doesNotMatch(result.html, /No media selected/);
  assert.match(result.html, /interactive-examples\.mdn\.mozilla\.net\/media\/cc0-videos\/flower\.mp4/);
  assert.match(result.html, /data:image\/svg\+xml/);
});
