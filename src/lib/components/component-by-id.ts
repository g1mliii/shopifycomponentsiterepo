import type { SupabaseClient } from "@supabase/supabase-js";

export const COMPONENT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicComponentById {
  id: string;
  title: string;
  category: string;
  thumbnail_path: string;
  created_at: string;
}

export interface ComponentByIdWithFilePath extends PublicComponentById {
  file_path: string;
}

export function isValidComponentId(value: string): boolean {
  return COMPONENT_ID_REGEX.test(value);
}

export async function getPublicComponentById(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  data: PublicComponentById | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from("shopify_components")
    .select("id, title, category, thumbnail_path, created_at")
    .eq("id", id)
    .maybeSingle();

  return {
    data: (data as PublicComponentById | null) ?? null,
    error: error ? { message: error.message } : null,
  };
}

export async function getComponentByIdWithFilePath(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  data: ComponentByIdWithFilePath | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from("shopify_components")
    .select("id, title, category, thumbnail_path, created_at, file_path")
    .eq("id", id)
    .maybeSingle();

  return {
    data: (data as ComponentByIdWithFilePath | null) ?? null,
    error: error ? { message: error.message } : null,
  };
}
