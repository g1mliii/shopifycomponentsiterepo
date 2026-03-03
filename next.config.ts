import type { NextConfig } from "next";

function getSupabaseImagePattern():
  | { protocol: "http" | "https"; hostname: string; port?: string }
  | null {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    if (!parsed.hostname) {
      return null;
    }

    return {
      protocol: parsed.protocol === "http:" ? "http" : "https",
      hostname: parsed.hostname,
      port: parsed.port || undefined,
    };
  } catch {
    return null;
  }
}

const supabaseImagePattern = getSupabaseImagePattern();

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  allowedDevOrigins: ["http://127.0.0.1:3000", "http://localhost:3000"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      ...(supabaseImagePattern ? [supabaseImagePattern] : []),
    ],
  },
};

export default nextConfig;
