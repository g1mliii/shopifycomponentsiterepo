import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { getComponentByIdWithFilePath, isValidComponentId } from "@/lib/components/component-by-id";
import { getDownloadRateLimitKey } from "@/lib/rate-limit/download-key";
import { consumeInMemoryRateLimit } from "@/lib/rate-limit/in-memory";
import { getPublicStorageObjectUrl } from "@/lib/supabase/public-storage-url";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const DOWNLOAD_RATE_LIMIT_MAX_ENTRIES = 2_000;

function sanitizeDownloadName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) {
    return "component";
  }
  return normalized.slice(0, 80);
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const params = await context.params;
  const componentId = params.id;

  if (!isValidComponentId(componentId)) {
    return apiError(400, "invalid_component_id", "A valid component id is required.", requestId);
  }

  const rateLimitResult = consumeInMemoryRateLimit(getDownloadRateLimitKey(request), {
    windowMs: 60_000,
    maxRequests: 20,
    maxEntries: DOWNLOAD_RATE_LIMIT_MAX_ENTRIES,
  });

  if (!rateLimitResult.allowed) {
    const response = apiError(
      429,
      "download_rate_limited",
      "Too many download requests. Please try again shortly.",
      requestId,
    );

    response.headers.set("Retry-After", String(rateLimitResult.retryAfterSeconds));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data: component, error: componentError } = await getComponentByIdWithFilePath(
      supabase,
      componentId,
    );

    if (componentError) {
      console.warn(
        "[public-components-download] component_lookup_failed",
        JSON.stringify({
          requestId,
          componentId,
          reason: componentError.message,
        }),
      );
      return apiError(500, "download_failed", "Failed to start component download.", requestId);
    }

    if (!component) {
      return apiError(404, "component_not_found", "Component not found.", requestId);
    }

    const downloadName = `${sanitizeDownloadName(component.title)}.liquid`;
    const publicDownloadUrl = getPublicStorageObjectUrl("liquid-files", component.file_path, {
      downloadFileName: downloadName,
    });

    return NextResponse.redirect(publicDownloadUrl, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.warn(
      "[public-components-download] unexpected_failure",
      JSON.stringify({
        requestId,
        componentId,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );

    return apiError(500, "download_failed", "Unexpected download failure.", requestId);
  }
}
