import type { MetadataRoute } from "next";

import { getAbsoluteUrl } from "@/lib/seo/site";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const SITEMAP_BATCH_SIZE = 1000;
const SITEMAP_MAX_COMPONENTS = 5000;

type SitemapComponentRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
};

function parseDate(value: string | null): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
}

async function listSitemapComponents(): Promise<SitemapComponentRow[]> {
  const supabase = await createServerSupabaseClient();
  const rows: SitemapComponentRow[] = [];

  for (let offset = 0; offset < SITEMAP_MAX_COMPONENTS; offset += SITEMAP_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("shopify_components")
      .select("id, created_at, updated_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + SITEMAP_BATCH_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load sitemap components: ${error.message}`);
    }

    const batch = (data ?? []) as SitemapComponentRow[];
    rows.push(...batch);

    if (batch.length < SITEMAP_BATCH_SIZE) {
      break;
    }
  }

  return rows;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: getAbsoluteUrl("/"),
      changeFrequency: "daily",
      priority: 1,
    },
  ];

  try {
    const components = await listSitemapComponents();

    for (const component of components) {
      entries.push({
        url: getAbsoluteUrl(`/components/${component.id}/sandbox`),
        lastModified: parseDate(component.updated_at) ?? parseDate(component.created_at),
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
  } catch {
    // Keep sitemap available even when component DB lookup fails.
  }

  return entries;
}
