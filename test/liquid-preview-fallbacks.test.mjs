import assert from "node:assert/strict";
import test from "node:test";

import { applyLiquidPreviewFallbacks } from "../src/lib/liquid/preview-fallbacks.ts";
import { renderLiquidPreview } from "../src/lib/liquid/render.ts";
import { parseLiquidSchema } from "../src/lib/liquid/schema-parse.ts";
import { buildInitialEditorState } from "../src/lib/liquid/schema-patch.ts";

const SECTION_SOURCE = `<section>
  <h2 id="collection-title">{{ section.settings.collection.title }}</h2>
  <ul id="collection-products">
    {% for product in section.settings.collection.products limit: section.settings.products_to_show %}
      <li>{{ product.title }}|{{ product.url }}|{{ product.featured_image }}</li>
    {% endfor %}
  </ul>
  <p id="menu">{{ section.settings.menu_links.handle }}|{% for label in section.settings.menu_links.links %}{{ label }};{% endfor %}</p>
  <img id="hero-image" src="{{ section.settings.hero_image | image_url: width: 400 }}" />
  <video id="hero-video"><source src="{{ section.settings.hero_video }}" type="video/mp4"></video>
</section>
{% schema %}
{
  "name": "Preview fallback section fixture",
  "settings": [
    { "type": "collection", "id": "collection", "label": "Collection" },
    { "type": "range", "id": "products_to_show", "label": "Products To Show", "default": 3, "min": 1, "max": 8 },
    { "type": "link_list", "id": "menu_links", "label": "Menu Links" },
    { "type": "image_picker", "id": "hero_image", "label": "Hero Image" },
    { "type": "video_url", "id": "hero_video", "label": "Hero Video" }
  ],
  "blocks": [],
  "presets": [{ "name": "Default" }]
}
{% endschema %}`;

const BLOCK_SOURCE = `<section>
  <div id="cards">
    {% for block in section.blocks %}
      <article>{{ block.settings.card_product.title }}|{{ block.settings.card_product.featured_image }}|{{ block.settings.card_video }}</article>
    {% endfor %}
  </div>
</section>
{% schema %}
{
  "name": "Preview fallback block fixture",
  "settings": [],
  "blocks": [
    {
      "type": "card",
      "name": "Card",
      "settings": [
        { "type": "product", "id": "card_product", "label": "Card Product" },
        { "type": "video_url", "id": "card_video", "label": "Card Video" }
      ]
    }
  ],
  "presets": [{ "name": "Default" }]
}
{% endschema %}`;

const TEXT_MEDIA_SOURCE = `<section>
  <video id="section-video" controls><source src="{{ section.settings.video_url }}" type="video/mp4"></video>
  <img id="section-image" src="{{ section.settings.image_url }}" alt="Section image" />
  {% for block in section.blocks %}
    <video id="block-video-{{ forloop.index }}" controls><source src="{{ block.settings.video_url }}" type="video/mp4"></video>
  {% endfor %}
</section>
{% schema %}
{
  "name": "Text media URL fallback fixture",
  "settings": [
    { "type": "text", "id": "video_url", "label": "Video URL" },
    { "type": "text", "id": "image_url", "label": "Image URL" }
  ],
  "blocks": [
    {
      "type": "video_item",
      "name": "Video Item",
      "settings": [
        { "type": "text", "id": "video_url", "label": "Video URL" }
      ]
    }
  ],
  "presets": [{ "name": "Default" }]
}
{% endschema %}`;

const DELAY_SOURCE = `<section>
  <div id="delay-seconds">{{ section.settings.show_delay }}</div>
</section>
{% schema %}
{
  "name": "Delay fixture",
  "settings": [
    { "type": "range", "id": "show_delay", "label": "Show After (seconds)", "min": 0, "max": 10, "step": 1, "default": 2 }
  ],
  "blocks": [],
  "presets": [{ "name": "Default" }]
}
{% endschema %}`;

function parseAndBuild(source) {
  const parsed = parseLiquidSchema(source);
  assert.ok(parsed.schema);
  const state = buildInitialEditorState(parsed.schema);
  return { schema: parsed.schema, state };
}

test("preview fallbacks provide mock section data for collection/products/media", async () => {
  const { schema, state } = parseAndBuild(SECTION_SOURCE);
  const fallbackState = applyLiquidPreviewFallbacks(schema, state);
  const rendered = await renderLiquidPreview(SECTION_SOURCE, fallbackState);

  const listMatches = rendered.html.match(/<li>/g) ?? [];
  assert.equal(listMatches.length, 3);
  assert.match(rendered.html, /id="collection-title">.+<\/h2>/);
  assert.match(rendered.html, /id="menu">menu-section-menu-links\|Shop;About;Support;/);
  assert.match(rendered.html, /data:image\/svg\+xml/);
  assert.match(rendered.html, /flower\.mp4/);
});

test("preview fallbacks apply to seeded block settings", async () => {
  const { schema, state } = parseAndBuild(BLOCK_SOURCE);
  assert.equal(state.blocks.length, 1);

  const fallbackState = applyLiquidPreviewFallbacks(schema, state);
  const rendered = await renderLiquidPreview(BLOCK_SOURCE, fallbackState);

  assert.match(rendered.html, /Card Product/);
  assert.match(rendered.html, /data:image\/svg\+xml/);
  assert.match(rendered.html, /flower\.mp4/);
});

test("preview fallbacks preserve explicit values already provided by the editor", async () => {
  const { schema, state } = parseAndBuild(SECTION_SOURCE);
  state.sectionSettings.collection = {
    handle: "collections/my-collection",
    title: "My Collection",
    url: "/collections/my-collection",
    products: [
      {
        handle: "products/my-product",
        title: "My Product",
        url: "/products/my-product",
        featured_image: "https://cdn.example.test/my-product.jpg",
        price: 1099,
      },
    ],
  };
  state.sectionSettings.menu_links = {
    handle: "custom-menu",
    links: ["One", "Two"],
  };
  state.sectionSettings.hero_image = "https://cdn.example.test/hero.jpg";
  state.sectionSettings.hero_video = "https://cdn.example.test/video.mp4";

  const fallbackState = applyLiquidPreviewFallbacks(schema, state);
  const rendered = await renderLiquidPreview(SECTION_SOURCE, fallbackState);

  assert.match(rendered.html, /My Collection/);
  assert.match(rendered.html, /My Product\|\/products\/my-product\|https:\/\/cdn\.example\.test\/my-product\.jpg/);
  assert.match(rendered.html, /id="menu">custom-menu\|One;Two;/);
  assert.match(rendered.html, /https:\/\/cdn\.example\.test\/hero\.jpg/);
  assert.match(rendered.html, /https:\/\/cdn\.example\.test\/video\.mp4/);
});

test("preview fallbacks infer media URLs for text-based media URL fields", async () => {
  const { schema, state } = parseAndBuild(TEXT_MEDIA_SOURCE);
  const fallbackState = applyLiquidPreviewFallbacks(schema, state);
  const rendered = await renderLiquidPreview(TEXT_MEDIA_SOURCE, fallbackState);

  assert.match(rendered.html, /interactive-examples\.mdn\.mozilla\.net\/media\/cc0-videos\/flower\.mp4/);
  assert.match(rendered.html, /data:image\/svg\+xml/);
});

test("preview fallbacks collapse default delay settings for immediate visibility", () => {
  const { schema, state } = parseAndBuild(DELAY_SOURCE);
  assert.equal(state.sectionSettings.show_delay, 2);

  const fallbackState = applyLiquidPreviewFallbacks(schema, state);
  assert.equal(fallbackState.sectionSettings.show_delay, 0);
});

test("preview fallbacks preserve user-edited delay settings", () => {
  const { schema, state } = parseAndBuild(DELAY_SOURCE);
  state.sectionSettings.show_delay = 5;

  const fallbackState = applyLiquidPreviewFallbacks(schema, state);
  assert.equal(fallbackState.sectionSettings.show_delay, 5);
});
