import { createClient } from "@supabase/supabase-js";

import { getSupabaseUrl } from "./env";

function getServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!value) {
    throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }

  return value;
}

export function createServiceRoleSupabaseClient() {
  return createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
