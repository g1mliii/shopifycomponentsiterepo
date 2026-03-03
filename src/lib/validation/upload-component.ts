import { z } from "zod";

const TITLE_MAX_LENGTH = 120;
const CATEGORY_MAX_LENGTH = 48;
const THUMBNAIL_MAX_BYTES = 25 * 1024 * 1024;
const LIQUID_MAX_BYTES = 2 * 1024 * 1024;

const thumbnailMimeToExtensions: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/avif": [".avif"],
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
};

const liquidAllowedMimeTypes = new Set([
  "text/plain",
  "text/x-liquid",
  "application/octet-stream",
  "",
]);

const liquidAllowedExtensions = new Set([".liquid"]);

const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(TITLE_MAX_LENGTH, `Title must be ${TITLE_MAX_LENGTH} characters or fewer.`);

const categorySchema = z
  .string()
  .trim()
  .min(1, "Category is required.")
  .max(
    CATEGORY_MAX_LENGTH,
    `Category must be ${CATEGORY_MAX_LENGTH} characters or fewer.`,
  )
  .transform((value) => value.toLowerCase());

export interface UploadComponentInput {
  title: string;
  category: string;
  thumbnailFile: File;
  liquidFile: File;
}

export interface ValidatedUploadComponentInput {
  title: string;
  category: string;
  thumbnailFile: File;
  liquidFile: File;
  thumbnailMimeType: string;
  liquidMimeType: string;
  thumbnailExtension: string;
  liquidExtension: string;
}

export interface ValidationIssue {
  field: "title" | "category" | "thumbnailFile" | "liquidFile";
  code:
    | "required"
    | "max_length"
    | "invalid_extension"
    | "invalid_mime"
    | "file_too_large"
    | "invalid_type";
  message: string;
}

type ValidationSuccess = {
  ok: true;
  data: ValidatedUploadComponentInput;
};

type ValidationFailure = {
  ok: false;
  issues: ValidationIssue[];
};

export const validationLimits = {
  TITLE_MAX_LENGTH,
  CATEGORY_MAX_LENGTH,
  THUMBNAIL_MAX_BYTES,
  LIQUID_MAX_BYTES,
} as const;

export function normalizeCategory(value: string): string {
  return value.trim().toLowerCase();
}

export function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");

  if (lastDot === -1) {
    return "";
  }

  return fileName.slice(lastDot).toLowerCase();
}

export function validateUploadComponentInput(
  input: UploadComponentInput,
): ValidationSuccess | ValidationFailure {
  const issues: ValidationIssue[] = [];

  const titleResult = titleSchema.safeParse(input.title);
  if (!titleResult.success) {
    issues.push({
      field: "title",
      code: mapTextErrorCode(titleResult.error.issues[0]?.code),
      message: titleResult.error.issues[0]?.message ?? "Invalid title.",
    });
  }

  const categoryResult = categorySchema.safeParse(input.category);
  if (!categoryResult.success) {
    issues.push({
      field: "category",
      code: mapTextErrorCode(categoryResult.error.issues[0]?.code),
      message: categoryResult.error.issues[0]?.message ?? "Invalid category.",
    });
  }

  const thumbnailExtension = getFileExtension(input.thumbnailFile.name);
  const thumbnailMimeType = input.thumbnailFile.type.toLowerCase();
  const thumbnailAllowedExtensions = thumbnailMimeToExtensions[thumbnailMimeType];

  if (!thumbnailAllowedExtensions) {
    issues.push({
      field: "thumbnailFile",
      code: "invalid_mime",
      message: "Thumbnail MIME type is not allowed.",
    });
  } else if (!thumbnailAllowedExtensions.includes(thumbnailExtension)) {
    issues.push({
      field: "thumbnailFile",
      code: "invalid_extension",
      message: "Thumbnail extension does not match MIME type.",
    });
  }

  if (input.thumbnailFile.size > THUMBNAIL_MAX_BYTES) {
    issues.push({
      field: "thumbnailFile",
      code: "file_too_large",
      message: `Thumbnail exceeds ${THUMBNAIL_MAX_BYTES} bytes.`,
    });
  }

  const liquidExtension = getFileExtension(input.liquidFile.name);
  const liquidMimeType = input.liquidFile.type.toLowerCase();

  if (!liquidAllowedExtensions.has(liquidExtension)) {
    issues.push({
      field: "liquidFile",
      code: "invalid_extension",
      message: "Liquid file must use the .liquid extension.",
    });
  }

  if (!liquidAllowedMimeTypes.has(liquidMimeType)) {
    issues.push({
      field: "liquidFile",
      code: "invalid_mime",
      message: "Liquid file MIME type is not allowed.",
    });
  }

  if (input.liquidFile.size > LIQUID_MAX_BYTES) {
    issues.push({
      field: "liquidFile",
      code: "file_too_large",
      message: `Liquid file exceeds ${LIQUID_MAX_BYTES} bytes.`,
    });
  }

  if (issues.length > 0 || !titleResult.success || !categoryResult.success) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    data: {
      title: titleResult.data,
      category: categoryResult.data,
      thumbnailFile: input.thumbnailFile,
      liquidFile: input.liquidFile,
      thumbnailMimeType,
      liquidMimeType,
      thumbnailExtension,
      liquidExtension,
    },
  };
}

function mapTextErrorCode(zodIssueCode: string | undefined): ValidationIssue["code"] {
  if (zodIssueCode === "too_big") {
    return "max_length";
  }

  return "required";
}
