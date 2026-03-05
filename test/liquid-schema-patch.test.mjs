import assert from "node:assert/strict";
import test from "node:test";

import { parseLiquidSchema } from "../src/lib/liquid/schema-parse.ts";
import { buildInitialEditorState, patchLiquidSchemaDefaults } from "../src/lib/liquid/schema-patch.ts";

const SOURCE = `{% assign heading = section.settings.heading %}
<section class="hero">
  <h2>{{ heading }}</h2>
  {% for block in section.blocks %}
    <article>{{ block.settings.title }}</article>
  {% endfor %}
</section>
{% schema %}
{
  "name": "Patch Test",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Original heading" },
    { "type": "range", "id": "padding", "label": "Padding", "default": 16, "min": 0, "max": 80 }
  ],
  "blocks": [
    {
      "type": "slide",
      "name": "Slide",
      "settings": [
        { "type": "text", "id": "title", "label": "Title", "default": "Original slide" }
      ]
    }
  ],
  "presets": [
    { "name": "Default", "blocks": [{ "type": "slide" }] }
  ]
}
{% endschema %}`;

const SOURCE_WITH_EMPTY_PRESET_BLOCKS = `{% schema %}
{
  "name": "Fallback Block Preset Test",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Fallback heading" }
  ],
  "blocks": [
    {
      "type": "quote",
      "name": "Quote",
      "settings": [
        { "type": "text", "id": "author", "label": "Author", "default": "Jane Doe" }
      ]
    }
  ],
  "presets": [
    { "name": "Default" }
  ]
}
{% endschema %}`;

test("patchLiquidSchemaDefaults updates defaults while preserving non-schema markup", () => {
  const parsed = parseLiquidSchema(SOURCE);
  assert.ok(parsed.schema);

  const state = buildInitialEditorState(parsed.schema);
  state.sectionSettings.heading = "Updated heading";
  state.sectionSettings.padding = 28;
  state.blocks[0].settings.title = "Updated slide title";

  const patched = patchLiquidSchemaDefaults(SOURCE, parsed.schema, state);

  assert.match(patched, /"id": "heading"[\s\S]*"default": "Updated heading"/);
  assert.match(patched, /"id": "padding"[\s\S]*"default": 28/);
  assert.match(patched, /"id": "title"[\s\S]*"default": "Updated slide title"/);
  assert.match(patched, /<h2>{{ heading }}<\/h2>/);
});

test("patched source remains parseable and carries preset block order", () => {
  const parsed = parseLiquidSchema(SOURCE);
  assert.ok(parsed.schema);

  const state = buildInitialEditorState(parsed.schema);
  state.blocks.push({
    id: "block_slide_2",
    type: "slide",
    settings: {
      title: "Second slide title",
    },
  });

  const patched = patchLiquidSchemaDefaults(SOURCE, parsed.schema, state);
  const reparsed = parseLiquidSchema(patched);

  assert.ok(reparsed.schema);
  assert.equal(reparsed.schema?.presets[0]?.blocks.length, 2);
  assert.equal(reparsed.schema?.presets[0]?.blocks[1]?.type, "slide");
});

test("buildInitialEditorState seeds one block per definition when preset blocks are missing", () => {
  const parsed = parseLiquidSchema(SOURCE_WITH_EMPTY_PRESET_BLOCKS);
  assert.ok(parsed.schema);

  const state = buildInitialEditorState(parsed.schema);
  assert.equal(state.blocks.length, 1);
  assert.equal(state.blocks[0]?.type, "quote");
  assert.equal(state.blocks[0]?.settings.author, "Jane Doe");
});
