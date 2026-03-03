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
  assert.equal(result.schema?.settings[1]?.support, "simulated");
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
