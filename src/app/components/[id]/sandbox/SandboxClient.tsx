"use client";

import Link from "next/link";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { PublicComponentById } from "@/lib/components/component-by-id";
import { formatUtcTimestamp } from "@/lib/datetime/format-utc-timestamp";
import { parseLiquidSchema } from "@/lib/liquid/schema-parse";
import { getSettingControlSpec } from "@/lib/liquid/schema-controls";
import {
  buildInitialEditorState,
  createBlockInstanceFromDefinition,
  patchLiquidSchemaDefaults,
} from "@/lib/liquid/schema-patch";
import { LatestPreviewScheduler } from "@/lib/liquid/preview-scheduler";
import { renderLiquidPreview, type LiquidRenderResult } from "@/lib/liquid/render";
import type {
  LiquidEditorState,
  LiquidSchema,
  LiquidSchemaDiagnostic,
  LiquidSchemaSetting,
  LiquidSettingJsonValue,
} from "@/lib/liquid/schema-types";

const MIN_SPLIT_PERCENT = 30;
const MAX_SPLIT_PERCENT = 70;
const MAX_RENDER_SAMPLES = 60;
const KEYBOARD_SPLIT_STEP_PERCENT = 4;
const PREVIEW_ENQUEUE_DEBOUNCE_MS = 80;

type SandboxClientProps = {
  component: PublicComponentById;
};

type LiquidSourceResponse = {
  source: string;
  schema: LiquidSchema | null;
  diagnostics: LiquidSchemaDiagnostic[];
};

type RenderInput = {
  source: string;
  state: LiquidEditorState;
};

type SettingControlProps = {
  setting: LiquidSchemaSetting;
  value: LiquidSettingJsonValue;
  pathKey: string;
  onChange: (pathKey: string, nextValue: LiquidSettingJsonValue) => void;
  onSelectLocalMedia: (pathKey: string, file: File | null) => void;
};

function toInputValue(value: LiquidSettingJsonValue): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function isRecordValue(value: LiquidSettingJsonValue): value is Record<string, LiquidSettingJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: LiquidSettingJsonValue): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : toInputValue(entry).trim()))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

type SimulatedResourceShape = {
  handle: string;
  title: string;
  url: string;
};

type SimulatedMetaobjectShape = {
  type: string;
  handle: string;
  id: string;
};

type SimulatedMenuShape = {
  handle: string;
  links: string[];
};

function toSimulatedResourceShape(value: LiquidSettingJsonValue): SimulatedResourceShape {
  if (isRecordValue(value)) {
    return {
      handle: typeof value.handle === "string" ? value.handle : "",
      title: typeof value.title === "string" ? value.title : "",
      url: typeof value.url === "string" ? value.url : "",
    };
  }

  if (typeof value === "string") {
    return {
      handle: value,
      title: "",
      url: "",
    };
  }

  return {
    handle: "",
    title: "",
    url: "",
  };
}

function toSimulatedMetaobjectShape(value: LiquidSettingJsonValue): SimulatedMetaobjectShape {
  if (isRecordValue(value)) {
    return {
      type: typeof value.type === "string" ? value.type : "",
      handle: typeof value.handle === "string" ? value.handle : "",
      id: typeof value.id === "string" ? value.id : "",
    };
  }

  return {
    type: "",
    handle: "",
    id: "",
  };
}

function toSimulatedMenuShape(value: LiquidSettingJsonValue): SimulatedMenuShape {
  if (isRecordValue(value)) {
    const linksValue = value.links;
    return {
      handle: typeof value.handle === "string" ? value.handle : "",
      links: Array.isArray(linksValue) ? toStringArray(linksValue as LiquidSettingJsonValue) : [],
    };
  }

  if (typeof value === "string") {
    return {
      handle: value,
      links: [],
    };
  }

  return {
    handle: "",
    links: [],
  };
}

type SimulatedEditorProps = {
  pathKey: string;
  value: LiquidSettingJsonValue;
  onChange: (pathKey: string, nextValue: LiquidSettingJsonValue) => void;
};

const SimulatedResourceEditor = memo(function SimulatedResourceEditor({
  pathKey,
  value,
  onChange,
}: SimulatedEditorProps) {
  const normalized = toSimulatedResourceShape(value);
  const inputClass =
    "mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1";

  const apply = useCallback(
    (patch: Partial<SimulatedResourceShape>) => {
      onChange(pathKey, {
        handle: patch.handle ?? normalized.handle,
        title: patch.title ?? normalized.title,
        url: patch.url ?? normalized.url,
      });
    },
    [normalized.handle, normalized.title, normalized.url, onChange, pathKey],
  );

  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <label className="block text-xs font-medium uppercase tracking-wide text-zinc-600" htmlFor={`${pathKey}:handle`}>
        Resource Handle / ID
      </label>
      <input
        id={`${pathKey}:handle`}
        type="text"
        value={normalized.handle}
        placeholder="products/example-handle"
        onChange={(event) => apply({ handle: event.target.value })}
        className={inputClass}
      />
      <label className="mt-2 block text-xs font-medium uppercase tracking-wide text-zinc-600" htmlFor={`${pathKey}:title`}>
        Resource Title
      </label>
      <input
        id={`${pathKey}:title`}
        type="text"
        value={normalized.title}
        placeholder="Optional title for preview context"
        onChange={(event) => apply({ title: event.target.value })}
        className={inputClass}
      />
      <label className="mt-2 block text-xs font-medium uppercase tracking-wide text-zinc-600" htmlFor={`${pathKey}:url`}>
        Resource URL
      </label>
      <input
        id={`${pathKey}:url`}
        type="url"
        value={normalized.url}
        placeholder="https://example.test/resource"
        onChange={(event) => apply({ url: event.target.value })}
        className={inputClass}
      />
      <p className="mt-2 text-xs text-zinc-600">Simulated picker values are stored as a lightweight object.</p>
    </div>
  );
});

const SimulatedMetaobjectEditor = memo(function SimulatedMetaobjectEditor({
  pathKey,
  value,
  onChange,
}: SimulatedEditorProps) {
  const normalized = toSimulatedMetaobjectShape(value);
  const inputClass =
    "mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1";

  const apply = useCallback(
    (patch: Partial<SimulatedMetaobjectShape>) => {
      onChange(pathKey, {
        type: patch.type ?? normalized.type,
        handle: patch.handle ?? normalized.handle,
        id: patch.id ?? normalized.id,
      });
    },
    [normalized.handle, normalized.id, normalized.type, onChange, pathKey],
  );

  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <label className="block text-xs font-medium uppercase tracking-wide text-zinc-600" htmlFor={`${pathKey}:type`}>
        Metaobject Type
      </label>
      <input
        id={`${pathKey}:type`}
        type="text"
        value={normalized.type}
        placeholder="custom.sample"
        onChange={(event) => apply({ type: event.target.value })}
        className={inputClass}
      />
      <label className="mt-2 block text-xs font-medium uppercase tracking-wide text-zinc-600" htmlFor={`${pathKey}:handle`}>
        Handle
      </label>
      <input
        id={`${pathKey}:handle`}
        type="text"
        value={normalized.handle}
        placeholder="metaobject-handle"
        onChange={(event) => apply({ handle: event.target.value })}
        className={inputClass}
      />
      <label className="mt-2 block text-xs font-medium uppercase tracking-wide text-zinc-600" htmlFor={`${pathKey}:id`}>
        ID
      </label>
      <input
        id={`${pathKey}:id`}
        type="text"
        value={normalized.id}
        placeholder="gid://shopify/Metaobject/123"
        onChange={(event) => apply({ id: event.target.value })}
        className={inputClass}
      />
      <p className="mt-2 text-xs text-zinc-600">Simulated metaobject values are editable for patch and preview tests.</p>
    </div>
  );
});

const SimulatedResourceListEditor = memo(function SimulatedResourceListEditor({
  pathKey,
  value,
  onChange,
}: SimulatedEditorProps) {
  const [draft, setDraft] = useState("");
  const entries = toStringArray(value);
  const inputClass =
    "mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1";

  const addDraft = useCallback(() => {
    const normalized = draft.trim();
    if (!normalized) {
      return;
    }

    onChange(pathKey, [...entries, normalized]);
    setDraft("");
  }, [draft, entries, onChange, pathKey]);

  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <label className="block text-xs font-medium uppercase tracking-wide text-zinc-600" htmlFor={`${pathKey}:draft`}>
        Add Reference
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={`${pathKey}:draft`}
          type="text"
          value={draft}
          placeholder="products/my-handle"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            addDraft();
          }}
          className={inputClass}
        />
        <button
          type="button"
          onClick={addDraft}
          className="inline-flex h-10 items-center rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1"
        >
          Add
        </button>
      </div>

      {entries.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {entries.map((entry, index) => (
            <li key={`${entry}-${index}`} className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700">
              <span>{entry}</span>
              <button
                type="button"
                onClick={() => onChange(pathKey, entries.filter((_item, itemIndex) => itemIndex !== index))}
                className="rounded px-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                aria-label={`Remove ${entry}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-zinc-600">No references added yet.</p>
      )}
    </div>
  );
});

const SimulatedMenuEditor = memo(function SimulatedMenuEditor({
  pathKey,
  value,
  onChange,
}: SimulatedEditorProps) {
  const normalized = toSimulatedMenuShape(value);
  const inputClass =
    "mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1";

  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <label className="block text-xs font-medium uppercase tracking-wide text-zinc-600" htmlFor={`${pathKey}:menu-handle`}>
        Menu Handle
      </label>
      <input
        id={`${pathKey}:menu-handle`}
        type="text"
        value={normalized.handle}
        placeholder="main-menu"
        onChange={(event) =>
          onChange(pathKey, {
            ...normalized,
            handle: event.target.value,
          })
        }
        className={inputClass}
      />

      <label className="mt-2 block text-xs font-medium uppercase tracking-wide text-zinc-600" htmlFor={`${pathKey}:menu-links`}>
        Mock Links (comma or newline separated)
      </label>
      <textarea
        id={`${pathKey}:menu-links`}
        value={normalized.links.join("\n")}
        rows={3}
        onChange={(event) =>
          onChange(pathKey, {
            ...normalized,
            links: toStringArray(event.target.value),
          })
        }
        className={inputClass}
      />
      <p className="mt-2 text-xs text-zinc-600">Menu links remain simulated in this standalone sandbox.</p>
    </div>
  );
});

function toTitleSlug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 64) : "component";
}

function buildPreviewDocument(html: string): string {
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

function createAbortError(): Error {
  const error = new Error("Preview render aborted.");
  error.name = "AbortError";
  return error;
}

function clampSplitPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_SPLIT_PERCENT;
  }

  return Math.min(MAX_SPLIT_PERCENT, Math.max(MIN_SPLIT_PERCENT, value));
}

function getSectionSettingPath(settingId: string): string {
  return `section:${settingId}`;
}

function getBlockSettingPath(blockId: string, settingId: string): string {
  return `block:${blockId}:${settingId}`;
}

function parseSettingPath(pathKey: string):
  | { kind: "section"; settingId: string }
  | { kind: "block"; blockId: string; settingId: string }
  | null {
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

function applyMediaOverrides(
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

const SettingControl = memo(function SettingControl({
  setting,
  value,
  pathKey,
  onChange,
  onSelectLocalMedia,
}: SettingControlProps) {
  const control = getSettingControlSpec(setting);

  const sharedInputClass =
    "mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-zinc-900" htmlFor={pathKey}>
          {setting.label}
        </label>
        {control.simulated ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Simulated
          </span>
        ) : null}
        {control.unknown ? (
          <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-800">
            Unknown
          </span>
        ) : null}
      </div>
      {setting.info ? <p className="mt-1 text-xs text-zinc-600">{setting.info}</p> : null}

      {control.kind === "checkbox" ? (
        <div className="mt-2">
          <input
            id={pathKey}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(pathKey, event.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          />
        </div>
      ) : null}

      {control.kind === "range" ? (
        <div className="mt-2">
          <input
            id={pathKey}
            type="range"
            min={setting.min ?? 0}
            max={setting.max ?? 100}
            step={setting.step ?? 1}
            value={typeof value === "number" ? value : Number.parseFloat(toInputValue(value)) || 0}
            onChange={(event) => onChange(pathKey, Number.parseFloat(event.target.value) || 0)}
            className="block w-full touch-manipulation accent-zinc-900"
          />
          <p className="mt-1 text-xs text-zinc-600">Value: {toInputValue(value)}</p>
        </div>
      ) : null}

      {control.kind === "number" ? (
        <input
          id={pathKey}
          type="number"
          min={setting.min ?? undefined}
          max={setting.max ?? undefined}
          step={setting.step ?? undefined}
          value={toInputValue(value)}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value);
            onChange(pathKey, Number.isFinite(parsed) ? parsed : 0);
          }}
          className={sharedInputClass}
        />
      ) : null}

      {control.kind === "color" ? (
        <input
          id={pathKey}
          type="color"
          value={toInputValue(value) || "#000000"}
          onChange={(event) => onChange(pathKey, event.target.value)}
          className="mt-1 h-10 w-20 rounded border border-zinc-300 bg-white"
        />
      ) : null}

      {control.kind === "select" ? (
        <select
          id={pathKey}
          value={toInputValue(value)}
          onChange={(event) => onChange(pathKey, event.target.value)}
          className={sharedInputClass}
        >
          {setting.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {control.kind === "textarea" ? (
        <textarea
          id={pathKey}
          value={toInputValue(value)}
          onChange={(event) => onChange(pathKey, event.target.value)}
          rows={4}
          className={sharedInputClass}
        />
      ) : null}

      {control.kind === "json" ? (
        <div className="mt-2">
          <textarea
            id={pathKey}
            value={toInputValue(value)}
            rows={4}
            onChange={(event) => {
              const nextValue = event.target.value;
              try {
                const parsed = JSON.parse(nextValue) as LiquidSettingJsonValue;
                onChange(pathKey, parsed);
              } catch {
                onChange(pathKey, nextValue);
              }
            }}
            className={sharedInputClass}
          />
          <p className="mt-1 text-xs text-zinc-600">JSON values are simulated in sandbox mode.</p>
        </div>
      ) : null}

      {control.kind === "simulated_resource" ? (
        <SimulatedResourceEditor pathKey={pathKey} value={value} onChange={onChange} />
      ) : null}

      {control.kind === "simulated_resource_list" ? (
        <SimulatedResourceListEditor pathKey={pathKey} value={value} onChange={onChange} />
      ) : null}

      {control.kind === "simulated_metaobject" ? (
        <SimulatedMetaobjectEditor pathKey={pathKey} value={value} onChange={onChange} />
      ) : null}

      {control.kind === "simulated_menu" ? (
        <SimulatedMenuEditor pathKey={pathKey} value={value} onChange={onChange} />
      ) : null}

      {control.kind === "text" || control.kind === "url" ? (
        <input
          id={pathKey}
          type={control.inputType}
          value={toInputValue(value)}
          placeholder={setting.placeholder ?? ""}
          onChange={(event) => onChange(pathKey, event.target.value)}
          className={sharedInputClass}
        />
      ) : null}

      {control.supportsLocalFilePreview ? (
        <div className="mt-2">
          <label className="block text-xs font-medium text-zinc-700" htmlFor={`${pathKey}:file`}>
            Local preview file (not persisted)
          </label>
          <input
            id={`${pathKey}:file`}
            type="file"
            accept="image/*,video/*"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onSelectLocalMedia(pathKey, file);
            }}
            className="mt-1 block w-full text-xs text-zinc-700 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-2 file:py-1 file:text-xs file:font-medium file:text-zinc-800"
          />
        </div>
      ) : null}
    </div>
  );
});

export function SandboxClient({ component }: SandboxClientProps) {
  const [isPendingTransition, startTransition] = useTransition();
  const [source, setSource] = useState<string | null>(null);
  const [schema, setSchema] = useState<LiquidSchema | null>(null);
  const [diagnostics, setDiagnostics] = useState<LiquidSchemaDiagnostic[]>([]);
  const [editorState, setEditorState] = useState<LiquidEditorState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [lastRenderDurationMs, setLastRenderDurationMs] = useState<number | null>(null);
  const [renderP95Ms, setRenderP95Ms] = useState<number | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [splitPercent, setSplitPercent] = useState(44);
  const [isResizing, setIsResizing] = useState(false);
  const [pendingBlockType, setPendingBlockType] = useState<string>("");
  const [mediaOverrides, setMediaOverrides] = useState<Record<string, string>>({});

  const schedulerRef = useRef<LatestPreviewScheduler<RenderInput, LiquidRenderResult> | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const renderSamplesRef = useRef<number[]>([]);
  const previewEnqueueTimerRef = useRef<number | null>(null);
  const blockIdCounterRef = useRef(0);
  const activePointerIdRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const resizePendingPercentRef = useRef<number | null>(null);
  const resizeBoundsRef = useRef<{ left: number; width: number } | null>(null);
  const liveSplitPercentRef = useRef(splitPercent);
  const mediaOverridesRef = useRef<Record<string, string>>(mediaOverrides);

  useEffect(() => {
    mediaOverridesRef.current = mediaOverrides;
  }, [mediaOverrides]);

  const blockDefinitionByType = useMemo(() => {
    const map = new Map<string, LiquidSchema["blocks"][number]>();
    for (const definition of schema?.blocks ?? []) {
      map.set(definition.type, definition);
    }
    return map;
  }, [schema]);

  const workspaceStyle = useMemo(
    () =>
      ({
        "--sandbox-left-pane": `${splitPercent}%`,
        gridTemplateColumns: "minmax(20rem, var(--sandbox-left-pane)) 0.625rem minmax(20rem, 1fr)",
        minHeight: "72dvh",
      }) as CSSProperties,
    [splitPercent],
  );

  const effectiveEditorState = useMemo(() => {
    if (!editorState) {
      return null;
    }

    return applyMediaOverrides(editorState, mediaOverrides);
  }, [editorState, mediaOverrides]);

  const iframeDocument = useMemo(() => buildPreviewDocument(previewHtml), [previewHtml]);

  const sectionUnsupportedSettingsCount = useMemo(() => {
    return (schema?.settings ?? []).filter((setting) => setting.support !== "native").length;
  }, [schema]);

  const blockUnsupportedSettingsCount = useMemo(() => {
    return (schema?.blocks ?? []).reduce((total, block) => {
      return total + block.settings.filter((setting) => setting.support !== "native").length;
    }, 0);
  }, [schema]);

  const blockCountByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const block of editorState?.blocks ?? []) {
      counts.set(block.type, (counts.get(block.type) ?? 0) + 1);
    }
    return counts;
  }, [editorState?.blocks]);

  const canAddSelectedBlock = useMemo(() => {
    if (!schema || !pendingBlockType) {
      return false;
    }

    const definition = blockDefinitionByType.get(pendingBlockType);
    if (!definition) {
      return false;
    }

    if (definition.limit === null || definition.limit <= 0) {
      return true;
    }

    return (blockCountByType.get(definition.type) ?? 0) < definition.limit;
  }, [blockCountByType, blockDefinitionByType, pendingBlockType, schema]);

  const updateRenderDurationStats = useCallback((durationMs: number) => {
    const samples = renderSamplesRef.current;
    samples.push(durationMs);
    if (samples.length > MAX_RENDER_SAMPLES) {
      samples.splice(0, samples.length - MAX_RENDER_SAMPLES);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    setRenderP95Ms(sorted[p95Index] ?? null);
  }, []);

  useEffect(() => {
    const scheduler = new LatestPreviewScheduler<RenderInput, LiquidRenderResult>({
      run: async (input, signal) => {
        if (signal.aborted) {
          throw createAbortError();
        }

        const result = await renderLiquidPreview(input.source, input.state, signal);

        if (signal.aborted) {
          throw createAbortError();
        }

        return result;
      },
      onSuccess: (result) => {
        startTransition(() => {
          setPreviewHtml(result.html);
          setPreviewError(null);
          setLastRenderDurationMs(result.durationMs);
          setIsRendering(false);
        });

        updateRenderDurationStats(result.durationMs);
      },
      onError: (error) => {
        startTransition(() => {
          setPreviewError(error instanceof Error ? error.message : "Failed to render preview.");
          setIsRendering(false);
        });
      },
    });

    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [startTransition, updateRenderDurationStats]);

  useEffect(() => {
    if (!source || !effectiveEditorState) {
      return;
    }

    setIsRendering(true);
    const nextInput: RenderInput = {
      source,
      state: effectiveEditorState,
    };

    if (previewEnqueueTimerRef.current !== null) {
      window.clearTimeout(previewEnqueueTimerRef.current);
      previewEnqueueTimerRef.current = null;
    }

    previewEnqueueTimerRef.current = window.setTimeout(() => {
      previewEnqueueTimerRef.current = null;
      schedulerRef.current?.enqueue(nextInput);
    }, PREVIEW_ENQUEUE_DEBOUNCE_MS);

    return () => {
      if (previewEnqueueTimerRef.current !== null) {
        window.clearTimeout(previewEnqueueTimerRef.current);
        previewEnqueueTimerRef.current = null;
      }
    };
  }, [source, effectiveEditorState]);

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;

    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      setPreviewError(null);

      try {
        const response = await fetch(`/api/components/${encodeURIComponent(component.id)}/liquid`, {
          method: "GET",
          signal: abortController.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(body.error?.message ?? "Failed to load Liquid source.");
        }

        const payload = (await response.json()) as LiquidSourceResponse;
        if (!active) {
          return;
        }

        const parsedResult = payload.schema
          ? { schema: payload.schema, diagnostics: payload.diagnostics }
          : parseLiquidSchema(payload.source);
        const initialState = parsedResult.schema ? buildInitialEditorState(parsedResult.schema) : null;

        setSource(payload.source);
        setSchema(parsedResult.schema);
        setDiagnostics(parsedResult.diagnostics);
        setEditorState(initialState);
        blockIdCounterRef.current = initialState?.blocks.length ?? 0;
        setPendingBlockType(parsedResult.schema?.blocks[0]?.type ?? "");
      } catch (error) {
        if (!active || abortController.signal.aborted) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : "Failed to load Liquid source.");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [component.id]);

  useEffect(() => {
    return () => {
      for (const value of Object.values(mediaOverridesRef.current)) {
        if (value.startsWith("blob:")) {
          URL.revokeObjectURL(value);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!workspaceRef.current) {
      return;
    }

    workspaceRef.current.style.setProperty("--sandbox-left-pane", `${splitPercent}%`);
    liveSplitPercentRef.current = splitPercent;
  }, [splitPercent]);

  const updateMediaOverride = useCallback((pathKey: string, nextValue: string | null) => {
    setMediaOverrides((current) => {
      const previousValue = current[pathKey];
      if (previousValue === nextValue) {
        return current;
      }

      if (previousValue?.startsWith("blob:")) {
        URL.revokeObjectURL(previousValue);
      }

      if (!nextValue) {
        const next = { ...current };
        delete next[pathKey];
        return next;
      }

      return {
        ...current,
        [pathKey]: nextValue,
      };
    });
  }, []);

  const handleSelectLocalMedia = useCallback(
    (pathKey: string, file: File | null) => {
      if (!file) {
        updateMediaOverride(pathKey, null);
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      updateMediaOverride(pathKey, objectUrl);
    },
    [updateMediaOverride],
  );

  const handleSettingValueChange = useCallback(
    (pathKey: string, nextValue: LiquidSettingJsonValue) => {
      const parsedPath = parseSettingPath(pathKey);
      if (!parsedPath) {
        return;
      }

      setEditorState((current) => {
        if (!current) {
          return current;
        }

        if (parsedPath.kind === "section") {
          return {
            ...current,
            sectionSettings: {
              ...current.sectionSettings,
              [parsedPath.settingId]: nextValue,
            },
          };
        }

        return {
          ...current,
          blocks: current.blocks.map((block) => {
            if (block.id !== parsedPath.blockId) {
              return block;
            }

            return {
              ...block,
              settings: {
                ...block.settings,
                [parsedPath.settingId]: nextValue,
              },
            };
          }),
        };
      });

      updateMediaOverride(pathKey, null);
    },
    [updateMediaOverride],
  );

  const handleAddBlock = useCallback(() => {
    if (!schema || !editorState || !pendingBlockType) {
      return;
    }

    const definition = blockDefinitionByType.get(pendingBlockType);
    if (!definition) {
      return;
    }

    const existingCount = blockCountByType.get(definition.type) ?? 0;
    if (definition.limit !== null && definition.limit > 0 && existingCount >= definition.limit) {
      return;
    }

    setEditorState((current) => {
      if (!current) {
        return current;
      }

      blockIdCounterRef.current += 1;
      const nextBlock = createBlockInstanceFromDefinition(
        schema,
        definition.type,
        blockIdCounterRef.current,
      );

      return {
        ...current,
        blocks: [...current.blocks, nextBlock],
      };
    });
  }, [blockCountByType, blockDefinitionByType, editorState, pendingBlockType, schema]);

  const handleRemoveBlock = useCallback((blockId: string) => {
    setEditorState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        blocks: current.blocks.filter((block) => block.id !== blockId),
      };
    });

    setMediaOverrides((current) => {
      const nextEntries = Object.entries(current).filter(([key]) => !key.startsWith(`block:${blockId}:`));
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }

      for (const [key, value] of Object.entries(current)) {
        if (key.startsWith(`block:${blockId}:`) && value.startsWith("blob:")) {
          URL.revokeObjectURL(value);
        }
      }

      return Object.fromEntries(nextEntries);
    });
  }, []);

  const handleMoveBlock = useCallback((blockId: string, direction: "up" | "down") => {
    setEditorState((current) => {
      if (!current) {
        return current;
      }

      const index = current.blocks.findIndex((block) => block.id === blockId);
      if (index < 0) {
        return current;
      }

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.blocks.length) {
        return current;
      }

      const nextBlocks = [...current.blocks];
      const [moved] = nextBlocks.splice(index, 1);
      nextBlocks.splice(targetIndex, 0, moved);

      return {
        ...current,
        blocks: nextBlocks,
      };
    });
  }, []);

  const syncResizeBounds = useCallback((): boolean => {
    if (!workspaceRef.current) {
      resizeBoundsRef.current = null;
      return false;
    }

    const bounds = workspaceRef.current.getBoundingClientRect();
    if (bounds.width <= 0) {
      resizeBoundsRef.current = null;
      return false;
    }

    resizeBoundsRef.current = {
      left: bounds.left,
      width: bounds.width,
    };
    return true;
  }, []);

  const applyPendingResize = useCallback(() => {
    resizeRafRef.current = null;
    const pending = resizePendingPercentRef.current;
    resizePendingPercentRef.current = null;
    if (pending === null || !workspaceRef.current) {
      return;
    }

    const clamped = clampSplitPercent(pending);
    liveSplitPercentRef.current = clamped;
    workspaceRef.current.style.setProperty("--sandbox-left-pane", `${clamped}%`);
  }, []);

  const queueResize = useCallback(
    (nextPercent: number) => {
      resizePendingPercentRef.current = clampSplitPercent(nextPercent);
      if (resizeRafRef.current !== null) {
        return;
      }

      resizeRafRef.current = window.requestAnimationFrame(applyPendingResize);
    },
    [applyPendingResize],
  );

  const handleGlobalPointerMove = useCallback(
    (event: PointerEvent) => {
      if (activePointerIdRef.current === null || activePointerIdRef.current !== event.pointerId) {
        return;
      }

      const bounds = resizeBoundsRef.current;
      if (!bounds && !syncResizeBounds()) {
        return;
      }

      const effectiveBounds = resizeBoundsRef.current;
      if (!effectiveBounds) {
        return;
      }
      const nextPercent = ((event.clientX - effectiveBounds.left) / effectiveBounds.width) * 100;
      queueResize(nextPercent);
    },
    [queueResize, syncResizeBounds],
  );

  const handleWindowResize = useCallback(() => {
    if (activePointerIdRef.current === null) {
      return;
    }

    syncResizeBounds();
  }, [syncResizeBounds]);

  const endResize = useCallback(() => {
    activePointerIdRef.current = null;
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", handleGlobalPointerMove);
    window.removeEventListener("resize", handleWindowResize);
    resizeBoundsRef.current = null;

    if (resizeRafRef.current !== null) {
      window.cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }

    setSplitPercent(clampSplitPercent(liveSplitPercentRef.current));
  }, [handleGlobalPointerMove, handleWindowResize]);

  const handleGlobalPointerUp = useCallback(
    (event: PointerEvent) => {
      if (activePointerIdRef.current === null || activePointerIdRef.current !== event.pointerId) {
        return;
      }

      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
      endResize();
    },
    [endResize],
  );

  useEffect(() => {
    return () => {
      activePointerIdRef.current = null;
      resizeBoundsRef.current = null;
      window.removeEventListener("pointermove", handleGlobalPointerMove);
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
      window.removeEventListener("resize", handleWindowResize);
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, [handleGlobalPointerMove, handleGlobalPointerUp, handleWindowResize]);

  const handleSplitterPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      activePointerIdRef.current = event.pointerId;
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      syncResizeBounds();
      window.addEventListener("pointermove", handleGlobalPointerMove);
      window.addEventListener("pointerup", handleGlobalPointerUp);
      window.addEventListener("pointercancel", handleGlobalPointerUp);
      window.addEventListener("resize", handleWindowResize);
    },
    [handleGlobalPointerMove, handleGlobalPointerUp, handleWindowResize, syncResizeBounds],
  );

  const handleSplitterKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") {
      return;
    }

    event.preventDefault();

    if (event.key === "Home") {
      setSplitPercent(MIN_SPLIT_PERCENT);
      return;
    }

    if (event.key === "End") {
      setSplitPercent(MAX_SPLIT_PERCENT);
      return;
    }

    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setSplitPercent((current) => clampSplitPercent(current + direction * KEYBOARD_SPLIT_STEP_PERCENT));
  }, []);

  const handleDownloadPatched = useCallback(() => {
    if (!source || !schema || !editorState) {
      return;
    }

    const patchedSource = patchLiquidSchemaDefaults(source, schema, editorState);
    const blob = new Blob([patchedSource], { type: "text/plain;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${toTitleSlug(component.title)}-patched.liquid`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  }, [component.title, editorState, schema, source]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <header className="mb-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Phase 4</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">Liquid Sandbox</h1>
            <p className="mt-1 text-sm text-zinc-600">
              {component.title} · {component.category} · uploaded {formatUtcTimestamp(component.created_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/components/${encodeURIComponent(component.id)}/download`}
              className="inline-flex h-10 items-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
            >
              Download Original
            </a>
            <button
              type="button"
              onClick={handleDownloadPatched}
              disabled={!editorState || !schema || !source}
              className="inline-flex h-10 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-offset-2"
            >
              Download Patched
            </button>
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
            >
              Back to Gallery
            </Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-600">
          <span>Last render: {lastRenderDurationMs !== null ? `${lastRenderDurationMs}ms` : "—"}</span>
          <span>p95 render: {renderP95Ms !== null ? `${renderP95Ms}ms` : "—"}</span>
          <span>Target: ≤120ms p95</span>
          {isRendering || isPendingTransition ? <span className="font-medium text-zinc-900">Rendering…</span> : null}
        </div>
      </header>

      {isLoading ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-700 shadow-sm">
          Loading Liquid source…
        </section>
      ) : loadError ? (
        <section className="rounded-2xl border border-red-300 bg-red-50 p-6 text-sm text-red-800 shadow-sm">
          {loadError}
        </section>
      ) : !schema || !editorState || !source ? (
        <section className="rounded-2xl border border-red-300 bg-red-50 p-6 text-sm text-red-800 shadow-sm">
          Schema parsing failed. This component cannot be edited in the sandbox yet.
        </section>
      ) : (
        <div ref={workspaceRef} className="grid min-h-[72vh] gap-3" style={workspaceStyle}>
          <section
            className="min-w-0 overflow-auto rounded-2xl border border-zinc-200 bg-zinc-50 p-3"
            style={{ contain: "layout paint style" }}
          >
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <h2 className="text-sm font-semibold text-zinc-900">Section Settings</h2>
                <p className="mt-1 text-xs text-zinc-600">
                  Unsupported/simulated controls: {sectionUnsupportedSettingsCount}
                </p>
              </div>

              {schema.settings.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                  No section settings were found in schema.
                </div>
              ) : (
                schema.settings.map((setting) => (
                  <SettingControl
                    key={setting.id}
                    setting={setting}
                    value={editorState.sectionSettings[setting.id] ?? ""}
                    pathKey={getSectionSettingPath(setting.id)}
                    onChange={handleSettingValueChange}
                    onSelectLocalMedia={handleSelectLocalMedia}
                  />
                ))
              )}

              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-900">Blocks</h2>
                    <p className="mt-1 text-xs text-zinc-600">
                      Unsupported/simulated block settings: {blockUnsupportedSettingsCount}
                    </p>
                  </div>
                  {schema.blocks.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={pendingBlockType}
                        onChange={(event) => setPendingBlockType(event.target.value)}
                        className="h-9 rounded-lg border border-zinc-300 px-3 text-xs text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1"
                      >
                        {schema.blocks.map((block) => (
                          <option key={block.type} value={block.type}>
                            {block.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!canAddSelectedBlock}
                        onClick={handleAddBlock}
                        className="inline-flex h-9 items-center rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1"
                      >
                        Add block
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {editorState.blocks.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
                  No block instances in current state.
                </div>
              ) : (
                editorState.blocks.map((block, index) => {
                  const definition = blockDefinitionByType.get(block.type);
                  return (
                    <div key={block.id} className="rounded-xl border border-zinc-200 bg-white p-3">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-zinc-900">
                          Block {index + 1}: {definition?.name ?? block.type}
                        </p>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleMoveBlock(block.id, "up")}
                            disabled={index === 0}
                            className="inline-flex h-8 items-center rounded-md border border-zinc-300 px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveBlock(block.id, "down")}
                            disabled={index === editorState.blocks.length - 1}
                            className="inline-flex h-8 items-center rounded-md border border-zinc-300 px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1"
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveBlock(block.id)}
                            className="inline-flex h-8 items-center rounded-md border border-red-300 px-2 text-xs text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {(definition?.settings ?? []).map((setting) => (
                          <SettingControl
                            key={`${block.id}:${setting.id}`}
                            setting={setting}
                            value={block.settings[setting.id] ?? ""}
                            pathKey={getBlockSettingPath(block.id, setting.id)}
                            onChange={handleSettingValueChange}
                            onSelectLocalMedia={handleSelectLocalMedia}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })
              )}

              {diagnostics.length > 0 ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <h3 className="text-sm font-semibold text-amber-900">Schema Diagnostics</h3>
                  <ul className="mt-2 space-y-1 text-xs text-amber-900">
                    {diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${index}`}>
                        [{diagnostic.level}] {diagnostic.message}
                        {diagnostic.path ? ` (${diagnostic.path})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>

          <div
            role="separator"
            aria-label="Resize editor and preview panels"
            aria-orientation="vertical"
            aria-valuemin={MIN_SPLIT_PERCENT}
            aria-valuemax={MAX_SPLIT_PERCENT}
            aria-valuenow={Math.round(splitPercent)}
            tabIndex={0}
            onPointerDown={handleSplitterPointerDown}
            onKeyDown={handleSplitterKeyDown}
            className={`group relative flex touch-none items-center justify-center rounded-full border ${
              isResizing
                ? "border-zinc-700 bg-zinc-900 text-white"
                : "border-zinc-300 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
            }`}
            style={{
              contain: "layout paint style",
              willChange: isResizing ? "transform" : "auto",
              transform: isResizing ? "translateZ(0)" : "none",
            }}
          >
            <span className="h-10 w-1.5 rounded-full bg-current/70" />
          </div>

          <section
            className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
            style={{ contain: "layout paint style" }}
          >
            <header className="border-b border-zinc-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-900">Preview</h2>
              {previewError ? <p className="mt-1 text-xs text-red-700">{previewError}</p> : null}
            </header>
            <div
              className="h-[calc(72vh-3.5rem)] min-h-[420px] w-full"
              style={{ height: "calc(72dvh - 3.5rem)" }}
            >
              <iframe title="Component preview" srcDoc={iframeDocument} sandbox="" className="h-full w-full border-0" />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
