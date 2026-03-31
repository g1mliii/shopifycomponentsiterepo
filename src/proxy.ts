import { NextResponse, type NextRequest } from "next/server";

const PREVIEW_SAMPLE_MEDIA_ORIGIN = "https://interactive-examples.mdn.mozilla.net";

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

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function buildCspValue(options?: { includeUnsafeEval?: boolean }): string {
  const connectSources = new Set(["'self'", "https://*.supabase.co", "wss://*.supabase.co"]);
  const imgSources = new Set(["'self'", "data:", "blob:", "https://*.supabase.co"]);
  const mediaSources = new Set(["'self'", "data:", "blob:", "https://*.supabase.co"]);
  const supabaseOrigin = getSupabaseOrigin();

  if (supabaseOrigin) {
    connectSources.add(supabaseOrigin);
    imgSources.add(supabaseOrigin);
    mediaSources.add(supabaseOrigin);
  }

  mediaSources.add(PREVIEW_SAMPLE_MEDIA_ORIGIN);

  // Static/ISR App Router pages cannot receive per-request nonces on Next runtime scripts,
  // so the outer document CSP must stay compatible with self-hosted bundles and inline
  // framework payloads. Preview iframe documents keep their own dedicated CSP.
  const scriptSources = ["'self'", "'unsafe-inline'"];
  if (options?.includeUnsafeEval) {
    scriptSources.push("'unsafe-eval'");
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
    "script-src " + scriptSources.join(" "),
    "script-src-attr 'none'",
    "connect-src " + Array.from(connectSources).join(" "),
    "worker-src 'self' blob:",
  ].join("; ");
}

function isDocumentRequest(request: NextRequest): boolean {
  if (request.method !== "GET") {
    return false;
  }

  const fetchDest = request.headers.get("sec-fetch-dest");
  if (fetchDest === "document") {
    return true;
  }

  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  return accept.includes("text/html");
}

export function proxy(request: NextRequest) {
  if (!isDocumentRequest(request)) {
    return NextResponse.next();
  }

  const isProduction = process.env.NODE_ENV === "production";
  const nonce = createNonce();
  const csp = buildCspValue({
    includeUnsafeEval: !isProduction,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("x-nonce", nonce);
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
