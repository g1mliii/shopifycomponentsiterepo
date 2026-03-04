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

function getSupabaseOrigin(): string | null {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function buildCspReportOnlyValue(): string {
  const connectSources = new Set(["'self'", "https://*.supabase.co", "wss://*.supabase.co"]);
  const imgSources = new Set(["'self'", "data:", "blob:", "https://*.supabase.co"]);
  const mediaSources = new Set(["'self'", "data:", "blob:", "https://*.supabase.co"]);
  const supabaseOrigin = getSupabaseOrigin();

  if (supabaseOrigin) {
    connectSources.add(supabaseOrigin);
    imgSources.add(supabaseOrigin);
    mediaSources.add(supabaseOrigin);
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src " + Array.from(imgSources).join(" "),
    "media-src " + Array.from(mediaSources).join(" "),
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src " + Array.from(connectSources).join(" "),
    "worker-src 'self' blob:",
  ].join("; ");
}

const supabaseImagePattern = getSupabaseImagePattern();
const cspReportOnlyValue = buildCspReportOnlyValue();

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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value: cspReportOnlyValue,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
