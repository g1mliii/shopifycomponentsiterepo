import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { getComponentByIdWithFilePath, isValidComponentId } from "@/lib/components/component-by-id";
import { parseLiquidSchema } from "@/lib/liquid/schema-parse";
import { getDownloadRateLimitKey } from "@/lib/rate-limit/download-key";
import { consumeInMemoryRateLimit } from "@/lib/rate-limit/in-memory";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

const LIQUID_ROUTE_RATE_LIMIT_MAX_ENTRIES = 2_000;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const { id } = await context.params;

  if (!isValidComponentId(id)) {
    return apiError(400, "invalid_component_id", "A valid component id is required.", requestId);
  }

  const rateLimitResult = consumeInMemoryRateLimit(getDownloadRateLimitKey(request), {
    windowMs: 60_000,
    maxRequests: 60,
    maxEntries: LIQUID_ROUTE_RATE_LIMIT_MAX_ENTRIES,
  });

  if (!rateLimitResult.allowed) {
    const response = apiError(
      429,
      "liquid_rate_limited",
      "Too many sandbox requests. Please try again shortly.",
      requestId,
    );
    response.headers.set("Retry-After", String(rateLimitResult.retryAfterSeconds));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  try {
    const supabase = createServiceRoleSupabaseClient();
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

    const { data: fileBlob, error: fileError } = await supabase.storage
      .from("liquid-files")
      .download(component.file_path);

    if (fileError || !fileBlob) {
      console.warn(
        "[public-component-liquid] source_download_failed",
        JSON.stringify({
          requestId,
          componentId: id,
          reason: fileError?.message ?? "missing_file_blob",
        }),
      );
      return apiError(500, "liquid_lookup_failed", "Failed to read component Liquid source.", requestId);
    }

    const source = await fileBlob.text();
    const parsed = parseLiquidSchema(source);

    return NextResponse.json(
      {
        source,
        schema: parsed.schema,
        diagnostics: parsed.diagnostics,
        requestId,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
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
