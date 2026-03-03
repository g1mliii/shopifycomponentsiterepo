import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getEnvOrEmpty } from "./env";

const FIXTURE_TOTAL = 13;
const HERO_CATEGORY = "hero";
const FOOTER_CATEGORY = "footer";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9xkR6wAAAABJRU5ErkJggg==";

type SeededComponent = {
  id: string;
  title: string;
  category: string;
  thumbnailPath: string;
  filePath: string;
};

export type PublicComponentsFixturesContext = {
  queryToken: string;
  firstComponentId: string;
  firstComponentTitle: string;
  componentIds: string[];
  serviceClient: SupabaseClient;
  cleanup: () => Promise<void>;
};

export async function setupPublicComponentsFixtures(): Promise<PublicComponentsFixturesContext | null> {
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

  const runId = randomUUID().replace(/-/g, "");
  const queryToken = `public-e2e-${runId.slice(0, 10)}`;
  const seeded: SeededComponent[] = [];

  try {
    for (let index = 0; index < FIXTURE_TOTAL; index += 1) {
      const id = randomUUID();
      const category = index % 2 === 0 ? HERO_CATEGORY : FOOTER_CATEGORY;
      const extension = index === 0 ? ".mp4" : ".png";

      const thumbnailPath = `components/${id}/thumbnail${extension}`;
      const filePath = `components/${id}/component.liquid`;

      const thumbnailBody =
        extension === ".mp4"
          ? Buffer.from("mock-mp4-video-content")
          : Buffer.from(TINY_PNG_BASE64, "base64");

      const { error: thumbnailError } = await serviceClient.storage
        .from("component-thumbnails")
        .upload(thumbnailPath, thumbnailBody, {
          contentType: extension === ".mp4" ? "video/mp4" : "image/png",
          cacheControl: "31536000",
          upsert: false,
        });

      if (thumbnailError) {
        throw new Error(`Failed to upload fixture thumbnail: ${thumbnailError.message}`);
      }

      const { error: liquidError } = await serviceClient.storage
        .from("liquid-files")
        .upload(
          filePath,
          Buffer.from(`{% schema %}{"name":"${queryToken} ${index}"}{% endschema %}`),
          {
            contentType: "text/plain",
            upsert: false,
          },
        );

      if (liquidError) {
        throw new Error(`Failed to upload fixture liquid file: ${liquidError.message}`);
      }

      seeded.push({
        id,
        title: `${queryToken} component ${String(index + 1).padStart(2, "0")}`,
        category,
        thumbnailPath,
        filePath,
      });
    }

    const baseTimestampMs = Date.now();
    const rows = seeded.map((component, index) => ({
      id: component.id,
      title: component.title,
      category: component.category,
      thumbnail_path: component.thumbnailPath,
      file_path: component.filePath,
      created_at: new Date(baseTimestampMs - index * 1000).toISOString(),
    }));

    const { error: insertError } = await serviceClient.from("shopify_components").insert(rows);
    if (insertError) {
      throw new Error(`Failed to insert fixture rows: ${insertError.message}`);
    }

    return {
      queryToken,
      firstComponentId: seeded[0]?.id ?? "",
      firstComponentTitle: seeded[0]?.title ?? "",
      componentIds: seeded.map((component) => component.id),
      serviceClient,
      cleanup: async () => {
        await serviceClient
          .from("shopify_components")
          .delete()
          .in(
            "id",
            seeded.map((component) => component.id),
          );

        await serviceClient.storage
          .from("component-thumbnails")
          .remove(seeded.map((component) => component.thumbnailPath));

        await serviceClient.storage
          .from("liquid-files")
          .remove(seeded.map((component) => component.filePath));
      },
    };
  } catch (error) {
    if (seeded.length > 0) {
      await serviceClient
        .from("shopify_components")
        .delete()
        .in(
          "id",
          seeded.map((component) => component.id),
        );

      await serviceClient.storage
        .from("component-thumbnails")
        .remove(seeded.map((component) => component.thumbnailPath));

      await serviceClient.storage
        .from("liquid-files")
        .remove(seeded.map((component) => component.filePath));
    }

    throw error;
  }
}
