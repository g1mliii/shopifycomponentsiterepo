import assert from "node:assert/strict";
import test from "node:test";

import { parseLiquidSchema } from "../src/lib/liquid/schema-parse.ts";
import {
  getUploadBlockingSchemaDiagnostics,
  getUploadBlockingSchemaMessage,
  getUploadSuggestionSchemaDiagnostics,
  getUploadSuggestionSchemaMessage,
} from "../src/lib/liquid/upload-blocking-diagnostics.ts";

test("getUploadBlockingSchemaDiagnostics treats duplicate setting ids as blocking", () => {
  const source = `{% schema %}
{
  "name": "Duplicate settings",
  "settings": [
    { "type": "text", "id": "button_text", "label": "Button Text", "default": "Shop now" },
    { "type": "color", "id": "button_text", "label": "Button Text Color", "default": "#000000" }
  ]
}
{% endschema %}`;

  const parsed = parseLiquidSchema(source);
  const blocking = getUploadBlockingSchemaDiagnostics(parsed.diagnostics);

  assert.equal(blocking.length, 1);
  assert.equal(blocking[0]?.code, "duplicate_setting_id");
  assert.match(
    getUploadBlockingSchemaMessage(parsed.diagnostics) ?? "",
    /duplicate setting IDs/i,
  );
});

test("getUploadBlockingSchemaDiagnostics ignores non-blocking parser warnings", () => {
  const source = `{% schema %}
{
  "name": "Missing setting id",
  "settings": [
    { "type": "text", "label": "Heading", "default": "Welcome" }
  ]
}
{% endschema %}`;

  const parsed = parseLiquidSchema(source);
  const blocking = getUploadBlockingSchemaDiagnostics(parsed.diagnostics);

  assert.equal(
    parsed.diagnostics.some((diagnostic) => diagnostic.code === "missing_setting_id"),
    true,
  );
  assert.equal(blocking.length, 0);
  assert.equal(getUploadBlockingSchemaMessage(parsed.diagnostics), null);
});

test("getUploadBlockingSchemaDiagnostics treats parser errors as blocking", () => {
  const parsed = parseLiquidSchema(`{% schema %}{ "name": "Broken", "settings": [ }{% endschema %}`);
  const blocking = getUploadBlockingSchemaDiagnostics(parsed.diagnostics);

  assert.equal(blocking.length, 1);
  assert.equal(blocking[0]?.level, "error");
  assert.match(
    getUploadBlockingSchemaMessage(parsed.diagnostics) ?? "",
    /blocking schema issues/i,
  );
});

test("getUploadBlockingSchemaDiagnostics treats schema/reference mismatches as blocking", () => {
  const source = `
{{ section.settings.missing_section_setting }}
{% for block in section.blocks %}
  {{ block.settings.missing_block_setting }}
{% endfor %}
{% schema %}
{
  "name": "Reference mismatch",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" }
  ],
  "blocks": [
    {
      "type": "cta",
      "name": "CTA",
      "settings": [
        { "type": "text", "id": "label", "label": "Label", "default": "Shop" }
      ]
    },
    {
      "type": "cta",
      "name": "CTA duplicate",
      "settings": [
        { "type": "text", "id": "headline", "label": "Headline", "default": "Hi" }
      ]
    }
  ],
  "presets": [
    {
      "name": "Default",
      "settings": {
        "missing_setting": "Oops"
      },
      "blocks": [
        { "type": "cta", "settings": { "missing_setting": "Oops" } }
      ]
    }
  ]
}
{% endschema %}`;

  const parsed = parseLiquidSchema(source);
  const blockingCodes = new Set(
    getUploadBlockingSchemaDiagnostics(parsed.diagnostics).map((entry) => entry.code),
  );

  assert.equal(blockingCodes.has("unknown_section_setting_reference"), true);
  assert.equal(blockingCodes.has("unknown_block_setting_reference"), true);
  assert.equal(blockingCodes.has("duplicate_block_type"), true);
  assert.equal(blockingCodes.has("unknown_preset_section_setting"), true);
  assert.equal(blockingCodes.has("unknown_preset_block_setting"), true);
  assert.match(
    getUploadBlockingSchemaMessage(parsed.diagnostics) ?? "",
    /blocking/i,
  );
});

test("getUploadSuggestionSchemaDiagnostics surfaces unused settings as non-blocking suggestions", () => {
  const source = `
{{ section.settings.heading }}
{% for block in section.blocks %}
  {{ block.settings.title }}
{% endfor %}
{% schema %}
{
  "name": "Unused settings",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Hello" },
    { "type": "text", "id": "eyebrow", "label": "Eyebrow", "default": "New" }
  ],
  "blocks": [
    {
      "type": "slide",
      "name": "Slide",
      "settings": [
        { "type": "text", "id": "title", "label": "Title", "default": "Welcome" },
        { "type": "text", "id": "subtitle", "label": "Subtitle", "default": "More" }
      ]
    }
  ]
}
{% endschema %}`;

  const parsed = parseLiquidSchema(source);
  const suggestionCodes = new Set(
    getUploadSuggestionSchemaDiagnostics(parsed.diagnostics).map((entry) => entry.code),
  );

  assert.equal(suggestionCodes.has("unused_section_setting"), true);
  assert.equal(suggestionCodes.has("unused_block_setting"), true);
  assert.match(
    getUploadSuggestionSchemaMessage(parsed.diagnostics) ?? "",
    /non-blocking schema suggestions/i,
  );
  assert.equal(getUploadBlockingSchemaDiagnostics(parsed.diagnostics).length, 0);
});
