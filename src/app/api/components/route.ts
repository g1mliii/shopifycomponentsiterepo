import { NextResponse } from "next/server";

import { apiError } from "@/lib/api/errors";
import {
  listPublicComponentsCached,
  parsePublicComponentsQuery,
} from "@/lib/components/public-query";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    const supabase = await createServerSupabaseClient();
    const { searchParams } = new URL(request.url);
    const query = parsePublicComponentsQuery(searchParams);

    const result = await listPublicComponentsCached(supabase, query);

    return NextResponse.json(
      {
        ...result,
        requestId,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    console.warn(
      "[public-components] list_failed",
      JSON.stringify({
        requestId,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );

    return apiError(500, "components_list_failed", "Failed to load components.", requestId);
  }
}
