"use client";
import {
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

import { SandboxHeader } from "./SandboxHeader";
import { SandboxWorkspace } from "./SandboxWorkspace";
import {
  MAX_SPLIT_PERCENT,
  MIN_SPLIT_PERCENT,
  KEYBOARD_SPLIT_STEP_PERCENT,
  PREVIEW_ENQUEUE_DEBOUNCE_MS,
  applyMediaOverrides,
  buildPreviewDocument,
  clampSplitPercent,
  createAbortError,
  parseSettingPath,
  readLocalMediaFileAsDataUrl,
  toTitleSlug,
} from "./sandbox-helpers";

import type { PublicComponentById } from "@/lib/components/component-by-id";
import { parseLiquidSchema } from "@/lib/liquid/schema-parse";
import {
  buildInitialEditorState,
  createBlockInstanceFromDefinition,
  patchLiquidSchemaDefaults,
} from "@/lib/liquid/schema-patch";
import { applyLiquidPreviewFallbacks } from "@/lib/liquid/preview-fallbacks";
import { buildSettingLookup } from "@/lib/liquid/visibility-hints";
import { LatestPreviewScheduler } from "@/lib/liquid/preview-scheduler";
import { renderLiquidPreview, type LiquidRenderResult } from "@/lib/liquid/render";
import type {
  LiquidEditorState,
  LiquidSchema,
  LiquidSchemaDiagnostic,
  LiquidSchemaSetting,
  LiquidSettingJsonValue,
} from "@/lib/liquid/schema-types";

const MAX_RENDER_SAMPLES = 60;

type SandboxClientProps = {
  component: PublicComponentById;
};

type RenderInput = {
  source: string;
  state: LiquidEditorState;
};

type LiquidRouteErrorResponse = {
  error?: {
    message?: string;
  };
};

class LiquidRouteHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LiquidRouteHttpError";
    this.status = status;
  }
}

async function readLiquidRouteErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return "Failed to load Liquid source.";
  }

  const payload = (await response.json().catch(() => null)) as LiquidRouteErrorResponse | null;
  const message = payload?.error?.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message;
  }

  return "Failed to load Liquid source.";
}

async function fetchLiquidSourceText(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    signal,
    cache: "force-cache",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new LiquidRouteHttpError(
      await readLiquidRouteErrorMessage(response),
      response.status,
    );
  }

  const source = await response.text();
  if (!source) {
    throw new LiquidRouteHttpError("Liquid source response was empty.", response.status);
  }

  return source;
}

async function loadLiquidSourceText(componentId: string, signal: AbortSignal): Promise<string> {
  const baseRoute = `/api/components/${encodeURIComponent(componentId)}/liquid`;

  try {
    return await fetchLiquidSourceText(baseRoute, signal);
  } catch (error) {
    if (signal.aborted || error instanceof LiquidRouteHttpError) {
      throw error;
    }

    return fetchLiquidSourceText(`${baseRoute}?mode=proxy`, signal);
  }
}

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
  const [isWorkspaceFullWidth, setIsWorkspaceFullWidth] = useState(true);
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
  const mediaSelectionVersionByPathRef = useRef<Map<string, number>>(new Map());

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

  const sectionSettingLookup = useMemo(() => buildSettingLookup(schema?.settings ?? []), [schema]);
  const blockSettingLookupByType = useMemo(() => {
    const map = new Map<string, Map<string, LiquidSchemaSetting>>();
    for (const definition of schema?.blocks ?? []) {
      map.set(definition.type, buildSettingLookup(definition.settings));
    }
    return map;
  }, [schema]);

  const workspaceStyle = useMemo(
    () =>
      ({
        "--sandbox-left-pane": `${splitPercent}%`,
        gridTemplateColumns: "minmax(14rem, var(--sandbox-left-pane)) 1.5rem minmax(14rem, 1fr)",
        height: "100%",
        minHeight: 0,
      }) as CSSProperties,
    [splitPercent],
  );

  const effectiveEditorState = useMemo(() => {
    if (!editorState) {
      return null;
    }

    const withMediaOverrides = applyMediaOverrides(editorState, mediaOverrides);
    if (!schema) {
      return withMediaOverrides;
    }

    return applyLiquidPreviewFallbacks(schema, withMediaOverrides);
  }, [editorState, mediaOverrides, schema]);

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
        const sourceText = await loadLiquidSourceText(component.id, abortController.signal);
        if (!active) {
          return;
        }

        const parsedResult = parseLiquidSchema(sourceText);
        const initialState = parsedResult.schema ? buildInitialEditorState(parsedResult.schema) : null;

        setSource(sourceText);
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
    const mediaSelectionVersionByPath = mediaSelectionVersionByPathRef.current;

    return () => {
      for (const value of Object.values(mediaOverridesRef.current)) {
        if (value.startsWith("blob:")) {
          URL.revokeObjectURL(value);
        }
      }

      mediaSelectionVersionByPath.clear();
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
      const versionMap = mediaSelectionVersionByPathRef.current;
      const nextVersion = (versionMap.get(pathKey) ?? 0) + 1;
      versionMap.set(pathKey, nextVersion);

      if (!file) {
        updateMediaOverride(pathKey, null);
        return;
      }

      void readLocalMediaFileAsDataUrl(file)
        .then((dataUrl) => {
          if (versionMap.get(pathKey) !== nextVersion) {
            return;
          }

          updateMediaOverride(pathKey, dataUrl);
        })
        .catch(() => {
          if (versionMap.get(pathKey) !== nextVersion) {
            return;
          }

          updateMediaOverride(pathKey, null);
        });
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
    },
    [],
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
      if (activePointerIdRef.current !== null) {
        return;
      }

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
    anchor.download = `${toTitleSlug(component.title)}-current.liquid`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  }, [component.title, editorState, schema, source]);

  const handleToggleWorkspaceWidth = useCallback(() => {
    setIsWorkspaceFullWidth((current) => !current);
  }, []);

  return (
    <main
      className={`sandbox-page mx-auto flex h-dvh w-full flex-col overflow-hidden px-4 pt-4 pb-0 sm:px-6 sm:pt-5 sm:pb-0 ${
        isWorkspaceFullWidth ? "max-w-none" : "max-w-[1500px]"
      }`}
    >
      <SandboxHeader
        component={component}
        canDownloadPatched={Boolean(editorState && schema && source)}
        onDownloadPatched={handleDownloadPatched}
        isWorkspaceFullWidth={isWorkspaceFullWidth}
        onToggleWorkspaceWidth={handleToggleWorkspaceWidth}
        lastRenderDurationMs={lastRenderDurationMs}
        renderP95Ms={renderP95Ms}
        isRendering={isRendering}
        isPendingTransition={isPendingTransition}
      />

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <section className="sandbox-card h-full overflow-auto p-6 text-sm" style={{ color: "var(--color-bark)" }}>
            Loading Liquid source…
          </section>
        ) : loadError ? (
          <section className="sandbox-card-danger h-full overflow-auto p-6 text-sm" style={{ color: "#8f2f29" }}>
            {loadError}
          </section>
        ) : !schema || !editorState || !source ? (
          <section className="sandbox-card-danger h-full overflow-auto p-6 text-sm" style={{ color: "#8f2f29" }}>
            Schema parsing failed. This component cannot be edited in the sandbox yet.
          </section>
        ) : (
          <SandboxWorkspace
            workspaceRef={workspaceRef}
            workspaceStyle={workspaceStyle}
            splitPercent={splitPercent}
            isResizing={isResizing}
            schema={schema}
            editorState={editorState}
            diagnostics={diagnostics}
            sectionUnsupportedSettingsCount={sectionUnsupportedSettingsCount}
            blockUnsupportedSettingsCount={blockUnsupportedSettingsCount}
            pendingBlockType={pendingBlockType}
            canAddSelectedBlock={canAddSelectedBlock}
            sectionSettingLookup={sectionSettingLookup}
            blockSettingLookupByType={blockSettingLookupByType}
            previewError={previewError}
            iframeDocument={iframeDocument}
            onPendingBlockTypeChange={setPendingBlockType}
            onAddBlock={handleAddBlock}
            onMoveBlock={handleMoveBlock}
            onRemoveBlock={handleRemoveBlock}
            onSettingValueChange={handleSettingValueChange}
            onSelectLocalMedia={handleSelectLocalMedia}
            onSplitterPointerDown={handleSplitterPointerDown}
            onSplitterKeyDown={handleSplitterKeyDown}
          />
        )}
      </div>
    </main>
  );
}
