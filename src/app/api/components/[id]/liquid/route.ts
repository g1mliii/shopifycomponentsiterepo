import { NextResponse } from "next/server";

import { NO_STORE_PRIVATE_CACHE_CONTROL, apiError } from "@/lib/api/errors";
import { getComponentByIdWithFilePath, isValidComponentId } from "@/lib/components/component-by-id";
import { getDownloadRateLimitKey } from "@/lib/rate-limit/download-key";
import { consumeSharedRateLimit } from "@/lib/rate-limit/shared";
import { createSignedStorageObjectUrl, downloadStorageObjectText } from "@/lib/supabase/signed-storage-url";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const LIQUID_ROUTE_RATE_LIMIT_MAX_ENTRIES = 2_000;
const LIQUID_ROUTE_REDIRECT_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=120";
const LIQUID_ROUTE_PROXY_SOURCE_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";
const LIQUID_SIGNED_URL_EXPIRY_SECONDS = 120;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isProxyModeRequest(request: Request): boolean {
  const mode = new URL(request.url).searchParams.get("mode");
  return mode === "proxy";
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const { id } = await context.params;

  if (!isValidComponentId(id)) {
    return apiError(400, "invalid_component_id", "A valid component id is required.", requestId);
  }

  try {
    const supabase = await createServerSupabaseClient();
    const rateLimitResult = await consumeSharedRateLimit(supabase, {
      key: getDownloadRateLimitKey(request),
      scope: "public_liquid",
      windowMs: 60_000,
      maxRequests: 60,
      fallbackMaxEntries: LIQUID_ROUTE_RATE_LIMIT_MAX_ENTRIES,
    });

    if (!rateLimitResult.allowed) {
      const response = apiError(
        429,
        "liquid_rate_limited",
        "Too many sandbox requests. Please try again shortly.",
        requestId,
      );
      response.headers.set("Retry-After", String(rateLimitResult.retryAfterSeconds));
      response.headers.set("Cache-Control", NO_STORE_PRIVATE_CACHE_CONTROL);
      return response;
    }

    const { data: component, error: componentError } = await getComponentByIdWithFilePath(supabase, id);

    if (componentError) {
      console.warn(
        "[public-component-liquid] component_lookup_failed",
        JSON.stringify({
          requestId,
          componentId: id,
          reason: componentError.message,
        }),
      );
      return apiError(500, "liquid_lookup_failed", "Failed to load component source.", requestId);
    }

    if (!component) {
      return apiError(404, "component_not_found", "Component not found.", requestId);
    }

    if (isProxyModeRequest(request)) {
      const { text: source, errorMessage: sourceErrorMessage } = await downloadStorageObjectText(
        "liquid-files",
        component.file_path,
      );

      if (!source) {
        console.warn(
          "[public-component-liquid] source_download_failed",
          JSON.stringify({
            requestId,
            componentId: id,
            reason: sourceErrorMessage ?? "storage_download_failed",
          }),
        );
        return apiError(500, "liquid_lookup_failed", "Failed to read component Liquid source.", requestId);
      }

      return new NextResponse(source, {
        status: 200,
        headers: {
          "Cache-Control": LIQUID_ROUTE_PROXY_SOURCE_CACHE_CONTROL,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const { signedUrl, errorMessage } = await createSignedStorageObjectUrl(
      "liquid-files",
      component.file_path,
      {
        expiresInSeconds: LIQUID_SIGNED_URL_EXPIRY_SECONDS,
      },
    );

    if (!signedUrl) {
      console.warn(
        "[public-component-liquid] signed_url_failed",
        JSON.stringify({
          requestId,
          componentId: id,
          reason: errorMessage ?? "unknown_signed_url_error",
        }),
      );
      return apiError(500, "liquid_lookup_failed", "Failed to load component source.", requestId);
    }

    return NextResponse.redirect(signedUrl, {
      status: 307,
      headers: {
        "Cache-Control": LIQUID_ROUTE_REDIRECT_CACHE_CONTROL,
      },
    });
  } catch (error) {
    console.warn(
      "[public-component-liquid] unexpected_failure",
      JSON.stringify({
        requestId,
        componentId: id,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );

    return apiError(500, "liquid_lookup_failed", "Unexpected Liquid source failure.", requestId);
  }
}
