import type { LiquidEditorState } from "./schema-types";

export const UPLOAD_DRAFT_STORAGE_KEY = "pressplay.admin-upload-draft.v1";
const UPLOAD_DRAFT_VERSION = 1;

export interface UploadDraftSnapshot {
  version: number;
  title: string;
  category: string;
  localLiquidSource: string;
  localLiquidFileName: string | null;
  editorState: LiquidEditorState | null;
  pendingBlockType: string;
  splitPercent: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function isLiquidBlockInstance(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string"
    && typeof value.type === "string"
    && isStringRecord(value.settings)
  );
}

function isLiquidEditorState(value: unknown): value is LiquidEditorState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isStringRecord(value.sectionSettings)
    && Array.isArray(value.blocks)
    && value.blocks.every((block) => isLiquidBlockInstance(block))
  );
}

export function parseUploadDraftSnapshot(value: unknown): UploadDraftSnapshot | null {
  if (!isRecord(value) || value.version !== UPLOAD_DRAFT_VERSION) {
    return null;
  }

  if (
    typeof value.title !== "string"
    || typeof value.category !== "string"
    || typeof value.localLiquidSource !== "string"
    || (value.localLiquidFileName !== null && typeof value.localLiquidFileName !== "string")
    || (value.editorState !== null && !isLiquidEditorState(value.editorState))
    || typeof value.pendingBlockType !== "string"
    || typeof value.splitPercent !== "number"
    || !Number.isFinite(value.splitPercent)
  ) {
    return null;
  }

  return {
    version: UPLOAD_DRAFT_VERSION,
    title: value.title,
    category: value.category,
    localLiquidSource: value.localLiquidSource,
    localLiquidFileName: value.localLiquidFileName,
    editorState: value.editorState,
    pendingBlockType: value.pendingBlockType,
    splitPercent: value.splitPercent,
  };
}
