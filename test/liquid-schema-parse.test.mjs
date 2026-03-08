import assert from "node:assert/strict";
import test from "node:test";

import { parseLiquidSchema } from "../src/lib/liquid/schema-parse.ts";

const VALID_LIQUID = `{% assign heading = section.settings.heading %}
<section>
  <h2>{{ heading }}</h2>
  {% for block in section.blocks %}
    <article>{{ block.settings.title }}</article>
  {% endfor %}
</section>
{% schema %}
{
  "name": "Sandbox component",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Welcome" },
    { "type": "product", "id": "featured_product", "label": "Featured product" }
  ],
  "blocks": [
    {
      "type": "slide",
      "name": "Slide",
      "settings": [
        { "type": "text", "id": "title", "label": "Title", "default": "First slide" }
      ]
    }
  ],
  "presets": [
    { "name": "Default", "blocks": [{ "type": "slide" }] }
  ]
}
{% endschema %}`;

test("parseLiquidSchema parses settings, blocks, and support levels", () => {
  const result = parseLiquidSchema(VALID_LIQUID);

  assert.ok(result.schema);
  assert.equal(result.schema?.name, "Sandbox component");
  assert.equal(result.schema?.settings.length, 2);
  assert.equal(result.schema?.blocks.length, 1);
  assert.equal(result.schema?.presets.length, 1);
  assert.equal(result.schema?.settings[0]?.support, "native");
  assert.equal(result.schema?.settings[1]?.support, "native");
  assert.equal(result.diagnostics.filter((entry) => entry.level === "error").length, 0);
});

test("parseLiquidSchema reports malformed schema JSON", () => {
  const malformed = `{% schema %}{ "name": "Broken", "settings": [ }{% endschema %}`;
  const result = parseLiquidSchema(malformed);

  assert.equal(result.schema, null);
  assert.ok(result.diagnostics.some((entry) => entry.code === "schema_json_invalid"));
});

test("parseLiquidSchema ignores header and paragraph pseudo-settings without id warnings", () => {
  const source = `{% schema %}
{
  "name": "Pseudo setting test",
  "settings": [
    { "type": "header", "content": "General" },
    { "type": "paragraph", "content": "Description text" },
    { "type": "text", "id": "headline", "label": "Headline", "default": "Value" }
  ]
}
{% endschema %}`;

  const result = parseLiquidSchema(source);

  assert.ok(result.schema);
  assert.equal(result.schema?.settings.length, 1);
  assert.equal(result.schema?.settings[0]?.id, "headline");
  assert.equal(
    result.diagnostics.some((entry) => entry.code === "missing_setting_id"),
    false,
  );
});

test("parseLiquidSchema treats future_setting_type as a supported text-like control", () => {
  const source = `{% schema %}
{
  "name": "Future setting support",
  "settings": [
    { "type": "future_setting_type", "id": "future_toggle", "label": "Future Toggle", "default": "experimental" }
  ]
}
{% endschema %}`;

  const result = parseLiquidSchema(source);

  assert.ok(result.schema);
  assert.equal(result.schema?.settings.length, 1);
  assert.equal(result.schema?.settings[0]?.support, "native");
});

test("parseLiquidSchema warns when section settings reuse the same id", () => {
  const source = `{% schema %}
{
  "name": "Duplicate section setting ids",
  "settings": [
    { "type": "text", "id": "button_text", "label": "Button Text", "default": "Shop now" },
    { "type": "color", "id": "button_text", "label": "Button Text Color", "default": "#000000" }
  ]
}
{% endschema %}`;

  const result = parseLiquidSchema(source);

  assert.ok(result.schema);
  assert.equal(
    result.diagnostics.some(
      (entry) =>
        entry.code === "duplicate_setting_id"
        && entry.path?.includes("settings[1].id")
        && entry.message.includes('Setting id "button_text"'),
    ),
    true,
  );
});

test("parseLiquidSchema warns when block settings reuse the same id", () => {
  const source = `{% schema %}
{
  "name": "Duplicate block setting ids",
  "blocks": [
    {
      "type": "cta",
      "name": "CTA",
      "settings": [
        { "type": "text", "id": "label", "label": "Button Text", "default": "Shop now" },
        { "type": "color", "id": "label", "label": "Button Text Color", "default": "#000000" }
      ]
    }
  ]
}
{% endschema %}`;

  const result = parseLiquidSchema(source);

  assert.ok(result.schema);
  assert.equal(
    result.diagnostics.some(
      (entry) =>
        entry.code === "duplicate_setting_id"
        && entry.path?.includes("blocks[0].settings[1].id")
        && entry.message.includes('block "cta" settings'),
    ),
    true,
  );
});

test("parseLiquidSchema warns when Liquid references missing section and block settings", () => {
  const source = `
<section style="color: {{ section.settings.heading_color }};">
  {{ section.settings.missing_section_setting }}
  {% for block in section.blocks %}
    {{ block.settings.title }}
    {{ block.settings.missing_block_setting }}
  {% endfor %}
</section>
{% schema %}
{
  "name": "Missing references",
  "settings": [
    { "type": "color", "id": "heading_color", "label": "Heading Color", "default": "#111111" }
  ],
  "blocks": [
    {
      "type": "item",
      "name": "Item",
      "settings": [
        { "type": "text", "id": "title", "label": "Title", "default": "Hello" }
      ]
    }
  ]
}
{% endschema %}`;

  const result = parseLiquidSchema(source);

  assert.ok(result.schema);
  assert.equal(
    result.diagnostics.some(
      (entry) =>
        entry.code === "unknown_section_setting_reference"
        && entry.path === "section.settings.missing_section_setting",
    ),
    true,
  );
  assert.equal(
    result.diagnostics.some(
      (entry) =>
        entry.code === "unknown_block_setting_reference"
        && entry.path === "block.settings.missing_block_setting",
    ),
    true,
  );
});

test("parseLiquidSchema warns when block types are duplicated or presets do not match block schema", () => {
  const source = `{% schema %}
{
  "name": "Preset mismatch",
  "blocks": [
    {
      "type": "cta",
      "name": "CTA A",
      "settings": [
        { "type": "text", "id": "label", "label": "Label", "default": "Buy now" }
      ]
    },
    {
      "type": "cta",
      "name": "CTA B",
      "settings": [
        { "type": "text", "id": "headline", "label": "Headline", "default": "Hi" }
      ]
    }
  ],
  "presets": [
    {
      "name": "Default",
      "blocks": [
        { "type": "cta", "settings": { "label": "Buy", "missing_setting": "Oops" } },
        { "type": "missing_block", "settings": { "label": "Nope" } }
      ]
    }
  ]
}
{% endschema %}`;

  const result = parseLiquidSchema(source);

  assert.ok(result.schema);
  assert.equal(
    result.diagnostics.some(
      (entry) =>
        entry.code === "duplicate_block_type"
        && entry.path?.includes("blocks[1].type"),
    ),
    true,
  );
  assert.equal(
    result.diagnostics.some(
      (entry) =>
        entry.code === "unknown_preset_block_setting"
        && entry.path === "presets[0].blocks[0].settings.missing_setting",
    ),
    true,
  );
  assert.equal(
    result.diagnostics.some(
      (entry) =>
        entry.code === "unknown_preset_block_type"
        && entry.path === "presets[0].blocks[1].type",
    ),
    true,
  );
});

test("parseLiquidSchema adds non-blocking info diagnostics for unused section and block settings", () => {
  const source = `
<section>
  {{ section.settings.heading }}
  {% for block in section.blocks %}
    {{ block.settings.title }}
  {% endfor %}
</section>
{% schema %}
{
  "name": "Unused settings",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Welcome" },
    { "type": "text", "id": "eyebrow", "label": "Eyebrow", "default": "New" }
  ],
  "blocks": [
    {
      "type": "slide",
      "name": "Slide",
      "settings": [
        { "type": "text", "id": "title", "label": "Title", "default": "Hello" },
        { "type": "text", "id": "subtitle", "label": "Subtitle", "default": "More" }
      ]
    }
  ]
}
{% endschema %}`;

  const result = parseLiquidSchema(source);

  assert.ok(result.schema);
  assert.equal(
    result.diagnostics.some(
      (entry) =>
        entry.code === "unused_section_setting"
        && entry.level === "info"
        && entry.path === "settings[1].id",
    ),
    true,
  );
  assert.equal(
    result.diagnostics.some(
      (entry) =>
        entry.code === "unused_block_setting"
        && entry.level === "info"
        && entry.path === "blocks[0].settings[1].id",
    ),
    true,
  );
});
