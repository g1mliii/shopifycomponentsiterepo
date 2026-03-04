import type { LiquidEditorState } from "@/lib/liquid/schema-types";

export const MIN_SPLIT_PERCENT = 18;
export const MAX_SPLIT_PERCENT = 82;
export const KEYBOARD_SPLIT_STEP_PERCENT = 4;
export const PREVIEW_ENQUEUE_DEBOUNCE_MS = 80;

export function toTitleSlug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 64) : "component";
}

export function buildPreviewDocument(html: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        padding: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: #111827;
        background: #ffffff;
      }
      img, video { max-width: 100%; height: auto; }
    </style>
  </head>
  <body>${html}</body>
</html>`;
}

export function createAbortError(): Error {
  const error = new Error("Preview render aborted.");
  error.name = "AbortError";
  return error;
}

export function clampSplitPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_SPLIT_PERCENT;
  }

  return Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, value));
}

export function getSectionSettingPath(settingId: string): string {
  return `section:${settingId}`;
}

export function getBlockSettingPath(blockId: string, settingId: string): string {
  return `block:${blockId}:${settingId}`;
}

export type ParsedSettingPath =
  | { kind: "section"; settingId: string }
  | { kind: "block"; blockId: string; settingId: string };

export function parseSettingPath(pathKey: string): ParsedSettingPath | null {
  if (pathKey.startsWith("section:")) {
    return {
      kind: "section",
      settingId: pathKey.slice("section:".length),
    };
  }

  if (pathKey.startsWith("block:")) {
    const segments = pathKey.split(":");
    if (segments.length >= 3) {
      return {
        kind: "block",
        blockId: segments[1] ?? "",
        settingId: segments.slice(2).join(":"),
      };
    }
  }

  return null;
}

export function applyMediaOverrides(
  editorState: LiquidEditorState,
  mediaOverrides: Record<string, string>,
): LiquidEditorState {
  if (Object.keys(mediaOverrides).length === 0) {
    return editorState;
  }

  const sectionSettings = {
    ...editorState.sectionSettings,
  };

  const blocks = editorState.blocks.map((block) => ({
    ...block,
    settings: {
      ...block.settings,
    },
  }));

  const blockIndexById = new Map<string, number>();
  for (const [index, block] of blocks.entries()) {
    blockIndexById.set(block.id, index);
  }

  for (const [pathKey, overrideUrl] of Object.entries(mediaOverrides)) {
    const parsed = parseSettingPath(pathKey);
    if (!parsed) {
      continue;
    }

    if (parsed.kind === "section") {
      sectionSettings[parsed.settingId] = overrideUrl;
      continue;
    }

    const blockIndex = blockIndexById.get(parsed.blockId);
    if (blockIndex === undefined) {
      continue;
    }

    blocks[blockIndex].settings[parsed.settingId] = overrideUrl;
  }

  return {
    sectionSettings,
    blocks,
  };
}
