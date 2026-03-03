import { createBrowserClient } from "@supabase/ssr";

const browserSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const browserSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createBrowserSupabaseClient() {
  if (!browserSupabaseUrl || !browserSupabaseAnonKey) {
    throw new Error(
      "Missing required browser environment variables: NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  if (!browserClient) {
    browserClient = createBrowserClient(browserSupabaseUrl, browserSupabaseAnonKey);
  }

  return browserClient;
}
