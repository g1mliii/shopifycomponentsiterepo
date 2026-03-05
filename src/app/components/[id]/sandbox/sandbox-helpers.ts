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
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; media-src data: blob: https: http:; font-src data: https: http:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; navigate-to 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none';"
    />
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
  const mediaOverrideEntries = Object.entries(mediaOverrides);
  if (mediaOverrideEntries.length === 0) {
    return editorState;
  }

  let sectionSettings = editorState.sectionSettings;
  let blocks = editorState.blocks;
  let blockIndexById: Map<string, number> | null = null;

  for (const [pathKey, overrideUrl] of mediaOverrideEntries) {
    const parsed = parseSettingPath(pathKey);
    if (!parsed) {
      continue;
    }

    if (parsed.kind === "section") {
      if (sectionSettings[parsed.settingId] === overrideUrl) {
        continue;
      }

      if (sectionSettings === editorState.sectionSettings) {
        sectionSettings = { ...editorState.sectionSettings };
      }
      sectionSettings[parsed.settingId] = overrideUrl;
      continue;
    }

    if (!blockIndexById) {
      blockIndexById = new Map<string, number>();
      for (const [index, block] of editorState.blocks.entries()) {
        blockIndexById.set(block.id, index);
      }
    }

    const blockIndex = blockIndexById.get(parsed.blockId);
    if (blockIndex === undefined) {
      continue;
    }

    const block = blocks[blockIndex];
    if (block.settings[parsed.settingId] === overrideUrl) {
      continue;
    }

    if (blocks === editorState.blocks) {
      blocks = [...editorState.blocks];
    }

    const currentBlock = blocks[blockIndex];
    blocks[blockIndex] = {
      ...currentBlock,
      settings: {
        ...currentBlock.settings,
        [parsed.settingId]: overrideUrl,
      },
    };
  }

  if (sectionSettings === editorState.sectionSettings && blocks === editorState.blocks) {
    return editorState;
  }

  return {
    sectionSettings,
    blocks,
  };
}
