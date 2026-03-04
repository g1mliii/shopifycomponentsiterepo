import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import { getPublicComponentById, isValidComponentId } from "@/lib/components/component-by-id";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const requestId = crypto.randomUUID();
  const { id } = await context.params;

  if (!isValidComponentId(id)) {
    return apiError(400, "invalid_component_id", "A valid component id is required.", requestId);
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data: component, error } = await getPublicComponentById(supabase, id);

    if (error) {
      console.warn(
        "[public-component-by-id] lookup_failed",
        JSON.stringify({
          requestId,
          componentId: id,
          reason: error.message,
        }),
      );
      return apiError(500, "component_lookup_failed", "Failed to load component.", requestId);
    }

    if (!component) {
      return apiError(404, "component_not_found", "Component not found.", requestId);
    }

    return NextResponse.json(
      {
        component,
        requestId,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    console.warn(
      "[public-component-by-id] unexpected_failure",
      JSON.stringify({
        requestId,
        componentId: id,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );

    return apiError(500, "component_lookup_failed", "Unexpected component lookup failure.", requestId);
  }
}
