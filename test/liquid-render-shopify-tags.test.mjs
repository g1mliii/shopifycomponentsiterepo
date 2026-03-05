import assert from "node:assert/strict";
import test from "node:test";

import { renderLiquidPreview } from "../src/lib/liquid/render.ts";
import { parseLiquidSchema } from "../src/lib/liquid/schema-parse.ts";
import { buildInitialEditorState } from "../src/lib/liquid/schema-patch.ts";

const SOURCE = `<section class="hero">{{ section.settings.heading }}</section>
{% style %}
  .hero { color: {{ section.settings.text_color }}; }
{% endstyle %}
{% javascript %}
  window.__preview_tag_test = true;
{% endjavascript %}
{% schema %}
{
  "name": "Theme tag fixture",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Shopify Theme Tag Support" },
    { "type": "color", "id": "text_color", "label": "Text Color", "default": "#111111" }
  ],
  "blocks": [],
  "presets": [{ "name": "Default" }]
}
{% endschema %}`;

test("renderLiquidPreview supports Shopify style/javascript block tags", async () => {
  const parsed = parseLiquidSchema(SOURCE);
  assert.ok(parsed.schema);

  const state = buildInitialEditorState(parsed.schema);
  const result = await renderLiquidPreview(SOURCE, state);

  assert.match(result.html, /Shopify Theme Tag Support/);
  assert.match(result.html, /<style>/);
  assert.match(result.html, /\.hero\s*\{\s*color:\s*#111111;/);
  assert.match(result.html, /<script>/);
  assert.match(result.html, /window\.__preview_tag_test = true/);
});

const SECTION_CONTEXT_SOURCE = `<section id="custom-{{ section.id }}">
  {% for block in section.blocks %}
    <div {{ block.shopify_attributes }}>{{ block.type }}</div>
  {% endfor %}
</section>
{% schema %}
{
  "name": "Section context fixture",
  "settings": [],
  "blocks": [
    {
      "type": "tile",
      "name": "Tile",
      "settings": [{ "type": "text", "id": "title", "label": "Title", "default": "Tile" }]
    }
  ],
  "presets": [{ "name": "Default" }]
}
{% endschema %}`;

test("renderLiquidPreview simulates Shopify section wrapper and block attributes", async () => {
  const parsed = parseLiquidSchema(SECTION_CONTEXT_SOURCE);
  assert.ok(parsed.schema);

  const state = buildInitialEditorState(parsed.schema);
  const result = await renderLiquidPreview(SECTION_CONTEXT_SOURCE, state);

  assert.match(result.html, /id="shopify-section-pressplay-preview-section"/);
  assert.match(result.html, /id="custom-pressplay-preview-section"/);
  assert.match(result.html, /data-block-id="block_tile_1"/);
  assert.match(result.html, /data-block-type="tile"/);
});
