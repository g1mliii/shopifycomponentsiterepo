import assert from "node:assert/strict";
import test from "node:test";

import { renderLiquidPreview } from "../src/lib/liquid/render.ts";
import { buildInitialEditorState, patchLiquidSchemaDefaults } from "../src/lib/liquid/schema-patch.ts";
import { parseLiquidSchema } from "../src/lib/liquid/schema-parse.ts";

const SOURCE = `<section>
  <div id="prod">{{ section.settings.featured_product.title }}|{{ section.settings.featured_product.handle }}</div>
  <ul id="related">{% for handle in section.settings.related_products %}<li>{{ handle }}</li>{% endfor %}</ul>
  <div id="menu">{{ section.settings.menu_links.handle }}|{% for label in section.settings.menu_links.links %}{{ label }};{% endfor %}</div>
  <div id="meta">{{ section.settings.featured_metaobject.type }}|{{ section.settings.featured_metaobject.handle }}</div>
  <div id="future">{{ section.settings.future_toggle }}</div>
</section>
{% schema %}
{
  "name": "Supported settings fixture",
  "settings": [
    { "type": "product", "id": "featured_product", "label": "Featured Product" },
    { "type": "product_list", "id": "related_products", "label": "Related Products" },
    { "type": "link_list", "id": "menu_links", "label": "Menu Links" },
    { "type": "metaobject", "id": "featured_metaobject", "label": "Featured Metaobject", "metaobject_type": "custom.sample" },
    { "type": "future_setting_type", "id": "future_toggle", "label": "Future Toggle", "default": "experimental" }
  ],
  "blocks": [],
  "presets": [{ "name": "Default" }]
}
{% endschema %}`;

function getSettingById(parsedSchema, id) {
  return parsedSchema.settings.find((setting) => setting.id === id);
}

test("supported resource/metaobject/future settings render through preview context", async () => {
  const parsed = parseLiquidSchema(SOURCE);
  assert.ok(parsed.schema);

  const state = buildInitialEditorState(parsed.schema);
  state.sectionSettings.featured_product = {
    handle: "products/ultra-pack",
    title: "Ultra Pack",
    url: "https://example.test/products/ultra-pack",
  };
  state.sectionSettings.related_products = ["products/a", "products/b"];
  state.sectionSettings.menu_links = {
    handle: "main-menu",
    links: ["Shop", "Docs"],
  };
  state.sectionSettings.featured_metaobject = {
    type: "custom.sample",
    handle: "entry-1",
    id: "gid://shopify/Metaobject/1",
  };
  state.sectionSettings.future_toggle = "enabled";

  const result = await renderLiquidPreview(SOURCE, state);
  assert.match(result.html, /Ultra Pack\|products\/ultra-pack/);
  assert.match(result.html, /<li>products\/a<\/li>/);
  assert.match(result.html, /<li>products\/b<\/li>/);
  assert.match(result.html, /main-menu\|Shop;Docs;/);
  assert.match(result.html, /custom\.sample\|entry-1/);
  assert.match(result.html, /<div id="future">enabled<\/div>/);
});

test("supported resource/metaobject/future settings persist into patched schema defaults", () => {
  const parsed = parseLiquidSchema(SOURCE);
  assert.ok(parsed.schema);

  const state = buildInitialEditorState(parsed.schema);
  const productValue = {
    handle: "products/ultra-pack",
    title: "Ultra Pack",
    url: "https://example.test/products/ultra-pack",
  };
  const listValue = ["products/a", "products/b"];
  const menuValue = {
    handle: "main-menu",
    links: ["Shop", "Docs"],
  };
  const metaobjectValue = {
    type: "custom.sample",
    handle: "entry-1",
    id: "gid://shopify/Metaobject/1",
  };

  state.sectionSettings.featured_product = productValue;
  state.sectionSettings.related_products = listValue;
  state.sectionSettings.menu_links = menuValue;
  state.sectionSettings.featured_metaobject = metaobjectValue;
  state.sectionSettings.future_toggle = "enabled";

  const patched = patchLiquidSchemaDefaults(SOURCE, parsed.schema, state);
  const reparsed = parseLiquidSchema(patched);
  assert.ok(reparsed.schema);

  assert.deepEqual(getSettingById(reparsed.schema, "featured_product")?.defaultValue, productValue);
  assert.deepEqual(getSettingById(reparsed.schema, "related_products")?.defaultValue, listValue);
  assert.deepEqual(getSettingById(reparsed.schema, "menu_links")?.defaultValue, menuValue);
  assert.deepEqual(getSettingById(reparsed.schema, "featured_metaobject")?.defaultValue, metaobjectValue);
  assert.equal(getSettingById(reparsed.schema, "future_toggle")?.defaultValue, "enabled");
});
