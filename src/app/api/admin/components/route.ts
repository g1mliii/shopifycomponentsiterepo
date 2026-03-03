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

type UploadAuditEvent = {
  requestId: string;
  userId?: string;
  result:
    | "auth_rejected"
    | "payload_invalid"
    | "validation_failed"
    | "upload_failed"
    | "db_insert_failed"
    | "success";
  status: number;
  durationMs: number;
};

function logUploadAudit(event: UploadAuditEvent) {
  console.info("[admin-components-upload]", JSON.stringify(event));
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

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const authResult = await requireAdmin();

  if (!authResult.ok) {
    const status = authResult.status;
    logUploadAudit({
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
      logUploadAudit({
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
      logUploadAudit({
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

      logUploadAudit({
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
      .select("id, title, category, thumbnail_path, file_path, created_at, updated_at")
      .single();

    if (insertError || !component) {
      await cleanupUploadedObjects(supabase, uploadedObjects, requestId);
      logUploadAudit({
        requestId,
        userId: user.id,
        result: "db_insert_failed",
        status: 500,
        durationMs: Date.now() - startedAt,
      });
      return apiError(500, "upload_failed", "Component record insert failed.", requestId);
    }

    logUploadAudit({
      requestId,
      userId: user.id,
      result: "success",
      status: 201,
      durationMs: Date.now() - startedAt,
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

    logUploadAudit({
      requestId,
      userId: user.id,
      result: "upload_failed",
      status: 500,
      durationMs: Date.now() - startedAt,
    });
    return apiError(500, "upload_failed", "Unexpected upload failure.", requestId);
  }
}
