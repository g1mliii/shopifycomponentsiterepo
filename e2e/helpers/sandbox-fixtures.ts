import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getEnvOrEmpty } from "./env";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9xkR6wAAAABJRU5ErkJggg==";

const SANDBOX_LIQUID_SOURCE = `{% assign heading = section.settings.heading %}
<section class="sandbox-component" style="padding: {{ section.settings.padding }}px;">
  {% if section.settings.show_heading %}
    <h2>{{ heading }}</h2>
  {% endif %}
  <div class="slides">
    {% for block in section.blocks %}
      <article class="slide-item">{{ block.settings.title }}</article>
    {% endfor %}
  </div>
</section>

{% schema %}
{
  "name": "Sandbox Fixture",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Initial heading" },
    { "type": "range", "id": "padding", "label": "Padding", "min": 0, "max": 80, "step": 2, "default": 20 },
    { "type": "checkbox", "id": "show_heading", "label": "Show heading", "default": true },
    { "type": "image_picker", "id": "hero_image", "label": "Hero image" }
  ],
  "blocks": [
    {
      "type": "slide",
      "name": "Slide",
      "limit": 4,
      "settings": [
        { "type": "text", "id": "title", "label": "Title", "default": "Slide title" },
        { "type": "url", "id": "link", "label": "Link" }
      ]
    }
  ],
  "presets": [
    {
      "name": "Sandbox Fixture",
      "blocks": [
        { "type": "slide", "settings": { "title": "First slide" } },
        { "type": "slide", "settings": { "title": "Second slide" } }
      ]
    }
  ]
}
{% endschema %}`;

export type SandboxFixtureContext = {
  componentId: string;
  title: string;
  serviceClient: SupabaseClient;
  cleanup: () => Promise<void>;
};

export async function setupSandboxFixture(): Promise<SandboxFixtureContext | null> {
  const supabaseUrl = getEnvOrEmpty("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnvOrEmpty("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const componentId = randomUUID();
  const title = `sandbox-e2e-${componentId.slice(0, 8)}`;
  const thumbnailPath = `components/${componentId}/thumbnail.png`;
  const filePath = `components/${componentId}/component.liquid`;

  try {
    const { error: thumbnailError } = await serviceClient.storage
      .from("component-thumbnails")
      .upload(thumbnailPath, Buffer.from(TINY_PNG_BASE64, "base64"), {
        contentType: "image/png",
        cacheControl: "31536000",
        upsert: false,
      });

    if (thumbnailError) {
      throw new Error(`Failed to upload sandbox thumbnail: ${thumbnailError.message}`);
    }

    const { error: liquidError } = await serviceClient.storage
      .from("liquid-files")
      .upload(filePath, Buffer.from(SANDBOX_LIQUID_SOURCE), {
        contentType: "text/plain",
        upsert: false,
      });

    if (liquidError) {
      throw new Error(`Failed to upload sandbox liquid source: ${liquidError.message}`);
    }

    const { error: insertError } = await serviceClient.from("shopify_components").insert({
      id: componentId,
      title,
      category: "sandbox",
      thumbnail_path: thumbnailPath,
      file_path: filePath,
    });

    if (insertError) {
      throw new Error(`Failed to insert sandbox fixture row: ${insertError.message}`);
    }

    return {
      componentId,
      title,
      serviceClient,
      cleanup: async () => {
        await serviceClient.from("shopify_components").delete().eq("id", componentId);
        await serviceClient.storage.from("component-thumbnails").remove([thumbnailPath]);
        await serviceClient.storage.from("liquid-files").remove([filePath]);
      },
    };
  } catch (error) {
    await serviceClient.from("shopify_components").delete().eq("id", componentId);
    await serviceClient.storage.from("component-thumbnails").remove([thumbnailPath]);
    await serviceClient.storage.from("liquid-files").remove([filePath]);
    throw error;
  }
}
