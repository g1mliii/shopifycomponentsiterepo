import { createClient } from "npm:@supabase/supabase-js@2";

type MissingStorageRow = {
  id: string;
  thumbnail_path: string;
  file_path: string;
  missing_thumbnail: boolean;
  missing_file: boolean;
};

type OrphanStorageObject = {
  bucket_id: "component-thumbnails" | "liquid-files";
  object_name: string;
};

type ReconcileSummary = {
  requestId: string;
  dryRun: boolean;
  rowLimit: number;
  orphanLimit: number;
  candidateRowsWithMissingStorage: number;
  deletedRows: number;
  candidateOrphanObjects: number;
  deletedOrphanObjects: number;
  removedPathsFromBrokenRows: number;
  ignoredMissingPaths: number;
  errors: string[];
};

const MAX_ROW_LIMIT = 500;
const MAX_ORPHAN_LIMIT = 1000;

function clampLimit(value: string | null, fallback: number, max: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function decodeBase64Url(input: string): string {
  let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) {
    normalized += "=";
  }
  return atob(normalized);
}

function getJwtRoleFromAuthorizationHeader(value: string | null): string | null {
  if (!value || !value.startsWith("Bearer ")) {
    return null;
  }

  const token = value.slice("Bearer ".length).trim();
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(segments[1])) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function isMissingObjectDeleteError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not found") ||
    normalized.includes("does not exist") ||
    normalized.includes("could not find") ||
    normalized.includes("no such")
  );
}

async function removePath(
  adminClient: ReturnType<typeof createClient>,
  bucket: "component-thumbnails" | "liquid-files",
  path: string,
): Promise<"removed" | "missing" | `error:${string}`> {
  const { error } = await adminClient.storage.from(bucket).remove([path]);
  if (!error) {
    return "removed";
  }

  if (isMissingObjectDeleteError(error.message)) {
    return "missing";
  }

  return `error:${bucket}:${path}:${error.message}`;
}

Deno.serve(async (request) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "method_not_allowed",
        message: "Use POST for reconciliation runs.",
        requestId,
      }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const callerRole = getJwtRoleFromAuthorizationHeader(request.headers.get("Authorization"));
  if (callerRole !== "service_role") {
    return new Response(
      JSON.stringify({
        error: "forbidden",
        message: "Only service_role callers may invoke this function.",
        requestId,
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({
        error: "configuration_error",
        message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
        requestId,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dry_run") === "true";
  const rowLimit = clampLimit(searchParams.get("row_limit"), 100, MAX_ROW_LIMIT);
  const orphanLimit = clampLimit(searchParams.get("orphan_limit"), 200, MAX_ORPHAN_LIMIT);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const summary: ReconcileSummary = {
    requestId,
    dryRun,
    rowLimit,
    orphanLimit,
    candidateRowsWithMissingStorage: 0,
    deletedRows: 0,
    candidateOrphanObjects: 0,
    deletedOrphanObjects: 0,
    removedPathsFromBrokenRows: 0,
    ignoredMissingPaths: 0,
    errors: [],
  };

  const { data: missingRowsRaw, error: missingRowsError } = await adminClient.rpc(
    "component_rows_with_missing_storage",
    { p_limit: rowLimit },
  );

  if (missingRowsError) {
    summary.errors.push(`missing_rows_query:${missingRowsError.message}`);
  }

  const missingRows = (missingRowsRaw ?? []) as MissingStorageRow[];
  summary.candidateRowsWithMissingStorage = missingRows.length;

  if (!dryRun) {
    for (const row of missingRows) {
      const { error: deleteRowError } = await adminClient
        .from("shopify_components")
        .delete()
        .eq("id", row.id);

      if (deleteRowError) {
        summary.errors.push(`delete_row:${row.id}:${deleteRowError.message}`);
        continue;
      }

      summary.deletedRows += 1;

      const thumbnailResult = await removePath(adminClient, "component-thumbnails", row.thumbnail_path);
      if (thumbnailResult === "removed") {
        summary.removedPathsFromBrokenRows += 1;
      } else if (thumbnailResult === "missing") {
        summary.ignoredMissingPaths += 1;
      } else {
        summary.errors.push(thumbnailResult);
      }

      const fileResult = await removePath(adminClient, "liquid-files", row.file_path);
      if (fileResult === "removed") {
        summary.removedPathsFromBrokenRows += 1;
      } else if (fileResult === "missing") {
        summary.ignoredMissingPaths += 1;
      } else {
        summary.errors.push(fileResult);
      }
    }
  }

  const { data: orphanObjectsRaw, error: orphanObjectsError } = await adminClient.rpc(
    "component_storage_orphans",
    { p_limit: orphanLimit },
  );

  if (orphanObjectsError) {
    summary.errors.push(`orphan_query:${orphanObjectsError.message}`);
  }

  const orphanObjects = (orphanObjectsRaw ?? []) as OrphanStorageObject[];
  summary.candidateOrphanObjects = orphanObjects.length;

  if (!dryRun) {
    for (const orphan of orphanObjects) {
      const removeResult = await removePath(adminClient, orphan.bucket_id, orphan.object_name);
      if (removeResult === "removed") {
        summary.deletedOrphanObjects += 1;
      } else if (removeResult === "missing") {
        summary.ignoredMissingPaths += 1;
      } else {
        summary.errors.push(removeResult);
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  const status = summary.errors.length > 0 ? 207 : 200;

  console.info(
    "[component-storage-reconcile]",
    JSON.stringify({
      ...summary,
      durationMs,
      status,
    }),
  );

  return new Response(
    JSON.stringify({
      ...summary,
      durationMs,
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
});
