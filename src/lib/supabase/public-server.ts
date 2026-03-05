import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

let publicSupabaseClient: SupabaseClient | null = null;

export function createPublicServerSupabaseClient(): SupabaseClient {
  if (publicSupabaseClient) {
    return publicSupabaseClient;
  }

  publicSupabaseClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return publicSupabaseClient;
}
