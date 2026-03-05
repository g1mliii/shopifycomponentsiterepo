import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { applyLiquidPreviewFallbacks } from "../src/lib/liquid/preview-fallbacks.ts";
import { renderLiquidPreview } from "../src/lib/liquid/render.ts";
import { parseLiquidSchema } from "../src/lib/liquid/schema-parse.ts";
import { buildInitialEditorState } from "../src/lib/liquid/schema-patch.ts";

const FIXTURES_DIR = path.resolve("test/fixtures");

const SUPPORTED_FALLBACK_TYPES = new Set([
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

function assertFallbackShape(type, value, location) {
  switch (type) {
    case "image_picker":
    case "video":
    case "video_url":
    case "url":
      assert.ok(isNonEmptyString(value), `${location} should be a non-empty string`);
      return;
    case "collection":
      assert.ok(isRecord(value), `${location} should be an object`);
      assert.ok(isNonEmptyString(value.handle), `${location}.handle should be non-empty`);
      assert.ok(Array.isArray(value.products), `${location}.products should be an array`);
      assert.ok(value.products.length > 0, `${location}.products should not be empty`);
      return;
    case "product":
    case "article":
    case "blog":
    case "page":
      assert.ok(isRecord(value), `${location} should be an object`);
      assert.ok(isNonEmptyString(value.handle), `${location}.handle should be non-empty`);
      return;
    case "collection_list":
    case "product_list":
    case "metaobject_list":
      assert.ok(Array.isArray(value), `${location} should be an array`);
      assert.ok(value.length > 0, `${location} should not be empty`);
      return;
    case "metaobject":
      assert.ok(isRecord(value), `${location} should be an object`);
      assert.ok(isNonEmptyString(value.type), `${location}.type should be non-empty`);
      assert.ok(isNonEmptyString(value.handle), `${location}.handle should be non-empty`);
      assert.ok(isNonEmptyString(value.id), `${location}.id should be non-empty`);
      return;
    case "link_list":
      assert.ok(isRecord(value), `${location} should be an object`);
      assert.ok(isNonEmptyString(value.handle), `${location}.handle should be non-empty`);
      assert.ok(Array.isArray(value.links), `${location}.links should be an array`);
      assert.ok(value.links.length > 0, `${location}.links should not be empty`);
      return;
    case "font_picker":
      assert.ok(isRecord(value), `${location} should be an object`);
      assert.ok(isNonEmptyString(value.family), `${location}.family should be non-empty`);
      return;
    default:
      return;
  }
}

test("fallback guard: fixture set covers all supported fallback types and renders with populated fallbacks", async () => {
  const fixtureFiles = fs
    .readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".liquid"))
    .map((entry) => path.join(FIXTURES_DIR, entry.name))
    .sort((a, b) => a.localeCompare(b));

  assert.ok(fixtureFiles.length > 0, "Expected at least one .liquid fixture in test/fixtures");

  const coveredTypes = new Set();

  for (const fixturePath of fixtureFiles) {
    const fixtureName = path.basename(fixturePath);
    const source = fs.readFileSync(fixturePath, "utf8");
    const parsed = parseLiquidSchema(source);

    assert.ok(parsed.schema, `${fixtureName} should include a parseable schema`);

    const state = buildInitialEditorState(parsed.schema);
    const fallbackState = applyLiquidPreviewFallbacks(parsed.schema, state);

    for (const setting of parsed.schema.settings) {
      const type = setting.type.toLowerCase();
      if (!SUPPORTED_FALLBACK_TYPES.has(type)) {
        continue;
      }
      coveredTypes.add(type);
      assertFallbackShape(
        type,
        fallbackState.sectionSettings[setting.id],
        `${fixtureName}:section.settings.${setting.id}`,
      );
    }

    for (const block of fallbackState.blocks) {
      const definition = parsed.schema.blocks.find((entry) => entry.type === block.type);
      if (!definition) {
        continue;
      }

      for (const setting of definition.settings) {
        const type = setting.type.toLowerCase();
        if (!SUPPORTED_FALLBACK_TYPES.has(type)) {
          continue;
        }
        coveredTypes.add(type);
        assertFallbackShape(
          type,
          block.settings[setting.id],
          `${fixtureName}:block(${block.type}).settings.${setting.id}`,
        );
      }
    }

    const rendered = await renderLiquidPreview(source, fallbackState);
    assert.ok(rendered.html.trim().length > 0, `${fixtureName} should render non-empty HTML`);
  }

  const missingTypes = [...SUPPORTED_FALLBACK_TYPES].filter((type) => !coveredTypes.has(type)).sort();
  assert.deepEqual(
    missingTypes,
    [],
    `Missing fallback coverage in fixtures for types: ${missingTypes.join(", ")}`,
  );
});
