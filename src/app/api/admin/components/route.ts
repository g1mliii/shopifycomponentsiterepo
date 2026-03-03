import { NextResponse } from "next/server";

import { type ServerSupabaseClient, requireAdmin } from "@/lib/auth/require-admin";
import { apiError } from "@/lib/api/errors";
import {
  type ValidationIssue,
  validateUploadComponentInput,
} from "@/lib/validation/upload-component";

type UploadedObjectRef = {
  bucket: "component-thumbnails" | "liquid-files";
  path: string;
};

type StoredComponent = {
  id: string;
  title: string;
  category: string;
  thumbnail_path: string;
  file_path: string;
  created_at: string;
  updated_at: string;
};

type ComponentsAuditEvent = {
  action: "list" | "upload" | "delete";
  requestId: string;
  userId?: string;
  result:
    | "auth_rejected"
    | "list_failed"
    | "list_success"
    | "payload_invalid"
    | "invalid_component_id"
    | "component_not_found"
    | "storage_delete_failed"
    | "db_delete_failed"
    | "delete_success"
    | "delete_success_with_storage_cleanup_warning"
    | "validation_failed"
    | "upload_failed"
    | "db_insert_failed"
    | "upload_success";
  status: number;
  durationMs: number;
  componentId?: string;
};

const COMPONENT_SELECT =
  "id, title, category, thumbnail_path, file_path, created_at, updated_at";
const COMPONENT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_COMPONENT_LIST_LIMIT = 50;
const MAX_COMPONENT_LIST_LIMIT = 100;

function parseComponentListLimit(searchParams: URLSearchParams): number {
  const rawLimit = searchParams.get("limit");
  if (!rawLimit) {
    return DEFAULT_COMPONENT_LIST_LIMIT;
  }

  const parsedLimit = Number.parseInt(rawLimit, 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return DEFAULT_COMPONENT_LIST_LIMIT;
  }

  return Math.min(parsedLimit, MAX_COMPONENT_LIST_LIMIT);
}

function logComponentsAudit(event: ComponentsAuditEvent) {
  console.info("[admin-components]", JSON.stringify(event));
}

function firstValidationMessage(issues: ValidationIssue[]): string {
  if (issues.length === 0) {
    return "Validation failed.";
  }

  return issues[0].message;
}

function hasFileTooLargeIssue(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.code === "file_too_large");
}

async function cleanupUploadedObjects(
  supabase: ServerSupabaseClient,
  uploadedObjects: UploadedObjectRef[],
  requestId: string,
) {
  const removeResults = await Promise.allSettled(
    uploadedObjects.map(({ bucket, path }) => supabase.storage.from(bucket).remove([path])),
  );

  for (const [index, result] of removeResults.entries()) {
    if (result.status !== "fulfilled" || result.value.error) {
      const ref = uploadedObjects[index];
      console.warn(
        "[admin-components-upload] cleanup_failed",
        JSON.stringify({
          requestId,
          bucket: ref.bucket,
          path: ref.path,
          reason:
            result.status === "rejected"
              ? String(result.reason)
              : result.value.error?.message ?? "unknown_cleanup_error",
        }),
      );
    }
  }
}

function isFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

async function deleteStorageForComponent(
  supabase: ServerSupabaseClient,
  component: Pick<StoredComponent, "thumbnail_path" | "file_path">,
): Promise<string[]> {
  const removeTargets = [
    {
      label: "thumbnail",
      bucket: "component-thumbnails" as const,
      path: component.thumbnail_path,
    },
    {
      label: "liquid_file",
      bucket: "liquid-files" as const,
      path: component.file_path,
    },
  ];

  const removeResults = await Promise.allSettled(
    removeTargets.map(({ bucket, path }) => supabase.storage.from(bucket).remove([path])),
  );

  const errors: string[] = [];
  for (const [index, result] of removeResults.entries()) {
    const target = removeTargets[index];
    if (result.status === "rejected") {
      const reason = errorMessageFromUnknown(result.reason);
      if (isMissingObjectDeleteError(reason)) {
        continue;
      }
      errors.push(`${target.label}: ${reason}`);
      continue;
    }

    if (result.value.error) {
      const reason = result.value.error.message;
      if (isMissingObjectDeleteError(reason)) {
        continue;
      }
      errors.push(`${target.label}: ${reason}`);
    }
  }

  return errors;
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const authResult = await requireAdmin();

  if (!authResult.ok) {
    const status = authResult.status;
    logComponentsAudit({
      action: "list",
      requestId,
      result: "auth_rejected",
      status,
      durationMs: Date.now() - startedAt,
    });
    return apiError(status, authResult.code, authResult.message, requestId);
  }

  const { supabase, user } = authResult;
  const { searchParams } = new URL(request.url);
  const limit = parseComponentListLimit(searchParams);
  const { data, error } = await supabase
    .from("shopify_components")
    .select(COMPONENT_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logComponentsAudit({
      action: "list",
      requestId,
      userId: user.id,
      result: "list_failed",
      status: 500,
      durationMs: Date.now() - startedAt,
    });
    return apiError(500, "list_failed", "Failed to list components.", requestId);
  }

  logComponentsAudit({
    action: "list",
    requestId,
    userId: user.id,
    result: "list_success",
    status: 200,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(
    {
      components: (data ?? []) as StoredComponent[],
      requestId,
      limit,
    },
    {
      status: 200,
    },
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const authResult = await requireAdmin();

  if (!authResult.ok) {
    const status = authResult.status;
    logComponentsAudit({
      action: "upload",
      requestId,
      result: "auth_rejected",
      status,
      durationMs: Date.now() - startedAt,
    });
    return apiError(status, authResult.code, authResult.message, requestId);
  }

  const { supabase, user } = authResult;
  const uploadedObjects: UploadedObjectRef[] = [];

  try {
    const formData = await request.formData();
    const title = formData.get("title");
    const category = formData.get("category");
    const thumbnail = formData.get("thumbnail");
    const liquidFile = formData.get("liquidFile");

    if (
      typeof title !== "string" ||
      typeof category !== "string" ||
      !isFile(thumbnail) ||
      !isFile(liquidFile)
    ) {
      logComponentsAudit({
        action: "upload",
        requestId,
        userId: user.id,
        result: "payload_invalid",
        status: 400,
        durationMs: Date.now() - startedAt,
      });
      return apiError(400, "invalid_payload", "Invalid multipart payload.", requestId);
    }

    const validationResult = validateUploadComponentInput({
      title,
      category,
      thumbnailFile: thumbnail,
      liquidFile,
    });

    if (!validationResult.ok) {
      const status = hasFileTooLargeIssue(validationResult.issues) ? 413 : 400;
      logComponentsAudit({
        action: "upload",
        requestId,
        userId: user.id,
        result: "validation_failed",
        status,
        durationMs: Date.now() - startedAt,
      });
      return apiError(
        status,
        "validation_failed",
        firstValidationMessage(validationResult.issues),
        requestId,
      );
    }

    const componentId = crypto.randomUUID();
    const thumbnailPath = `components/${componentId}/thumbnail${validationResult.data.thumbnailExtension}`;
    const filePath = `components/${componentId}/component${validationResult.data.liquidExtension}`;

    const [thumbnailUploadResult, liquidUploadResult] = await Promise.all([
      supabase.storage
        .from("component-thumbnails")
        .upload(thumbnailPath, validationResult.data.thumbnailFile, {
          contentType: validationResult.data.thumbnailMimeType,
          upsert: false,
        }),
      supabase.storage
        .from("liquid-files")
        .upload(filePath, validationResult.data.liquidFile, {
          contentType: validationResult.data.liquidMimeType || "application/octet-stream",
          upsert: false,
        }),
    ]);

    if (!thumbnailUploadResult.error) {
      uploadedObjects.push({
        bucket: "component-thumbnails",
        path: thumbnailPath,
      });
    }

    if (!liquidUploadResult.error) {
      uploadedObjects.push({
        bucket: "liquid-files",
        path: filePath,
      });
    }

    if (thumbnailUploadResult.error || liquidUploadResult.error) {
      if (uploadedObjects.length > 0) {
        await cleanupUploadedObjects(supabase, uploadedObjects, requestId);
      }

      logComponentsAudit({
        action: "upload",
        requestId,
        userId: user.id,
        result: "upload_failed",
        status: 500,
        durationMs: Date.now() - startedAt,
      });

      if (thumbnailUploadResult.error) {
        return apiError(500, "upload_failed", "Thumbnail upload failed.", requestId);
      }

      return apiError(500, "upload_failed", "Liquid file upload failed.", requestId);
    }

    const { data: component, error: insertError } = await supabase
      .from("shopify_components")
      .insert({
        id: componentId,
        title: validationResult.data.title,
        category: validationResult.data.category,
        thumbnail_path: thumbnailPath,
        file_path: filePath,
      })
      .select(COMPONENT_SELECT)
      .single();

    if (insertError || !component) {
      await cleanupUploadedObjects(supabase, uploadedObjects, requestId);
      logComponentsAudit({
        action: "upload",
        requestId,
        userId: user.id,
        result: "db_insert_failed",
        status: 500,
        durationMs: Date.now() - startedAt,
      });
      return apiError(500, "upload_failed", "Component record insert failed.", requestId);
    }

    logComponentsAudit({
      action: "upload",
      requestId,
      userId: user.id,
      result: "upload_success",
      status: 201,
      durationMs: Date.now() - startedAt,
      componentId: component.id,
    });

    return NextResponse.json(
      {
        component,
        requestId,
      },
      {
        status: 201,
      },
    );
  } catch {
    if (uploadedObjects.length > 0) {
      await cleanupUploadedObjects(supabase, uploadedObjects, requestId);
    }

    logComponentsAudit({
      action: "upload",
      requestId,
      userId: user.id,
      result: "upload_failed",
      status: 500,
      durationMs: Date.now() - startedAt,
    });
    return apiError(500, "upload_failed", "Unexpected upload failure.", requestId);
  }
}

export async function DELETE(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const authResult = await requireAdmin();

  if (!authResult.ok) {
    const status = authResult.status;
    logComponentsAudit({
      action: "delete",
      requestId,
      result: "auth_rejected",
      status,
      durationMs: Date.now() - startedAt,
    });
    return apiError(status, authResult.code, authResult.message, requestId);
  }

  const { supabase, user } = authResult;
  const { searchParams } = new URL(request.url);
  const componentId = searchParams.get("id");

  if (!componentId || !COMPONENT_ID_REGEX.test(componentId)) {
    logComponentsAudit({
      action: "delete",
      requestId,
      userId: user.id,
      result: "invalid_component_id",
      status: 400,
      durationMs: Date.now() - startedAt,
    });
    return apiError(400, "invalid_component_id", "A valid component id is required.", requestId);
  }

  const { data: componentToDelete, error: lookupError } = await supabase
    .from("shopify_components")
    .select(COMPONENT_SELECT)
    .eq("id", componentId)
    .maybeSingle();

  if (lookupError) {
    logComponentsAudit({
      action: "delete",
      requestId,
      userId: user.id,
      componentId,
      result: "db_delete_failed",
      status: 500,
      durationMs: Date.now() - startedAt,
    });
    return apiError(500, "delete_failed", "Failed to read component before delete.", requestId);
  }

  if (!componentToDelete) {
    logComponentsAudit({
      action: "delete",
      requestId,
      userId: user.id,
      componentId,
      result: "component_not_found",
      status: 404,
      durationMs: Date.now() - startedAt,
    });
    return apiError(404, "component_not_found", "Component not found.", requestId);
  }

  const { error: rowDeleteError } = await supabase
    .from("shopify_components")
    .delete()
    .eq("id", componentId);

  if (rowDeleteError) {
    logComponentsAudit({
      action: "delete",
      requestId,
      userId: user.id,
      componentId,
      result: "db_delete_failed",
      status: 500,
      durationMs: Date.now() - startedAt,
    });
    return apiError(500, "delete_failed", "Failed to delete component record.", requestId);
  }

  const storageDeleteErrors = await deleteStorageForComponent(supabase, componentToDelete);
  if (storageDeleteErrors.length > 0) {
    console.warn(
      "[admin-components-delete] storage_cleanup_failed",
      JSON.stringify({
        requestId,
        componentId,
        errors: storageDeleteErrors,
      }),
    );
    logComponentsAudit({
      action: "delete",
      requestId,
      userId: user.id,
      componentId,
      result: "delete_success_with_storage_cleanup_warning",
      status: 200,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        deletedComponentId: componentId,
        requestId,
      },
      {
        status: 200,
      },
    );
  }

  logComponentsAudit({
    action: "delete",
    requestId,
    userId: user.id,
    componentId,
    result: "delete_success",
    status: 200,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(
    {
      deletedComponentId: componentId,
      requestId,
    },
    {
      status: 200,
    },
  );
}
