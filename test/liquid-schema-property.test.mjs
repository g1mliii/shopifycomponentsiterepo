import assert from "node:assert/strict";
import test from "node:test";

import { parseLiquidSchema } from "../src/lib/liquid/schema-parse.ts";
import { buildInitialEditorState, patchLiquidSchemaDefaults } from "../src/lib/liquid/schema-patch.ts";

const PROPERTY_SOURCE = `{% schema %}
{
  "name": "Property Test",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "A" },
    { "type": "number", "id": "count", "label": "Count", "default": 1 }
  ]
}
{% endschema %}`;

function randomHeading(index) {
  return `heading-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function randomCount() {
  return Math.floor(Math.random() * 1000);
}

test("patchLiquidSchemaDefaults preserves patch roundtrip invariants across random values", () => {
  const parsed = parseLiquidSchema(PROPERTY_SOURCE);
  assert.ok(parsed.schema);

  for (let iteration = 0; iteration < 25; iteration += 1) {
    const heading = randomHeading(iteration);
    const count = randomCount();

    const state = buildInitialEditorState(parsed.schema);
    state.sectionSettings.heading = heading;
    state.sectionSettings.count = count;

    const patched = patchLiquidSchemaDefaults(PROPERTY_SOURCE, parsed.schema, state);
    const reparsed = parseLiquidSchema(patched);

    assert.ok(reparsed.schema);
    const headingSetting = reparsed.schema.settings.find((setting) => setting.id === "heading");
    const countSetting = reparsed.schema.settings.find((setting) => setting.id === "count");
    assert.equal(headingSetting?.defaultValue, heading);
    assert.equal(countSetting?.defaultValue, count);
  }
});
