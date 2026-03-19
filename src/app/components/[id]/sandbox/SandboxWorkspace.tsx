"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent as ReactChangeEvent,
  CSSProperties,
  FormEvent as ReactFormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import { SettingControl } from "./setting-control";
import {
  MAX_SPLIT_PERCENT,
  MIN_SPLIT_PERCENT,
  type PreviewMode,
  getBlockSettingPath,
  getSectionSettingPath,
} from "./sandbox-helpers";

import { getPlainLanguageSettingLabel } from "@/lib/liquid/setting-labels";
import { getConditionalVisibilityHints } from "@/lib/liquid/visibility-hints";
import type {
  LiquidEditorState,
  LiquidSchema,
  LiquidSchemaEditorEntry,
  LiquidSchemaDiagnostic,
  LiquidSchemaPresentation,
  LiquidSchemaSetting,
  LiquidSettingJsonValue,
} from "@/lib/liquid/schema-types";

const EMPTY_SETTING_LOOKUP = new Map<string, LiquidSchemaSetting>();

type SandboxWorkspaceProps = {
  workspaceRef: RefObject<HTMLDivElement | null>;
  workspaceStyle: CSSProperties;
  splitPercent: number;
  isResizing: boolean;
  schema: LiquidSchema;
  editorState: LiquidEditorState;
  diagnostics: LiquidSchemaDiagnostic[];
  sectionUnsupportedSettingsCount: number;
  blockUnsupportedSettingsCount: number;
  pendingBlockType: string;
  canAddSelectedBlock: boolean;
  sectionSettingLookup: Map<string, LiquidSchemaSetting>;
  blockSettingLookupByType: Map<string, Map<string, LiquidSchemaSetting>>;
  previewError: string | null;
  iframeDocument: string;
  getFullPreviewDocument: () => string;
  previewTitle?: string;
  previewViewportAspectRatio?: string;
  previewMode: PreviewMode;
  fitPreviewToContent: boolean;
  onPreviewModeChange: (mode: PreviewMode) => void;
  onFitPreviewToContentChange: (value: boolean) => void;
  onPendingBlockTypeChange: (value: string) => void;
  onAddBlock: () => void;
  onMoveBlock: (blockId: string, direction: "up" | "down") => void;
  onRemoveBlock: (blockId: string) => void;
  onSettingValueChange: (pathKey: string, nextValue: LiquidSettingJsonValue) => void;
  onSelectLocalMedia: (pathKey: string, file: File | null) => void;
  onSplitterPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSplitterKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

type PreviewMetrics = {
  flowHeight: number;
  maxScrollTop: number;
  scale: number;
  scrollTop: number;
  visualHeight: number;
  visualWidth: number;
  viewportHeight: number;
  viewportLockedLayout: boolean;
};

function renderPresentationEntry(
  presentation: LiquidSchemaPresentation,
  key: string,
) {
  if (presentation.type === "header") {
    return (
      <div key={key} className="px-1 pt-1">
        <h3
          className="sandbox-muted text-xs font-semibold uppercase tracking-[0.18em]"
          data-testid="sandbox-schema-header"
        >
          {presentation.content}
        </h3>
      </div>
    );
  }

  return (
    <div key={key} className="px-1">
      <p
        className="sandbox-muted text-xs leading-relaxed"
        data-testid="sandbox-schema-paragraph"
      >
        {presentation.content}
      </p>
    </div>
  );
}

function renderEditorEntry(
  entry: LiquidSchemaEditorEntry,
  key: string,
  value: LiquidSettingJsonValue,
  pathKey: string,
  conditionalHints: string[] | undefined,
  onSettingValueChange: (pathKey: string, nextValue: LiquidSettingJsonValue) => void,
  onSelectLocalMedia: (pathKey: string, file: File | null) => void,
) {
  if (entry.kind === "presentation") {
    return renderPresentationEntry(entry.presentation, key);
  }

  return (
    <SettingControl
      key={key}
      setting={entry.setting}
      value={value}
      pathKey={pathKey}
      conditionalHints={conditionalHints}
      onChange={onSettingValueChange}
      onSelectLocalMedia={onSelectLocalMedia}
    />
  );
}

export function SandboxWorkspace({
  workspaceRef,
  workspaceStyle,
  splitPercent,
  isResizing,
  schema,
  editorState,
  diagnostics,
  sectionUnsupportedSettingsCount,
  blockUnsupportedSettingsCount,
  pendingBlockType,
  canAddSelectedBlock,
  sectionSettingLookup,
  blockSettingLookupByType,
  previewError,
  iframeDocument,
  getFullPreviewDocument,
  previewTitle,
  previewViewportAspectRatio,
  previewMode,
  fitPreviewToContent,
  onPreviewModeChange,
  onFitPreviewToContentChange,
  onPendingBlockTypeChange,
  onAddBlock,
  onMoveBlock,
  onRemoveBlock,
  onSettingValueChange,
  onSelectLocalMedia,
  onSplitterPointerDown,
  onSplitterKeyDown,
}: SandboxWorkspaceProps) {
  const hasBlockControls = schema.blocks.length > 0 || editorState.blocks.length > 0;
  const hasPreviewAspectRatio = typeof previewViewportAspectRatio === "string"
    && previewViewportAspectRatio.trim().length > 0;
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(() => new Set());
  const [previewMetrics, setPreviewMetrics] = useState<PreviewMetrics | null>(null);
  const [previewScrollPercent, setPreviewScrollPercent] = useState(0);
  const [fullPreviewError, setFullPreviewError] = useState<string | null>(null);
  const [loadedIframeDocument, setLoadedIframeDocument] = useState<string | null>(null);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewSyncTimeoutIdsRef = useRef<number[]>([]);

  const blockDefinitionByType = useMemo(() => {
    const map = new Map<string, LiquidSchema["blocks"][number]>();
    for (const definition of schema.blocks) {
      map.set(definition.type, definition);
    }
    return map;
  }, [schema.blocks]);

  const collapsedActiveBlockCount = useMemo(() => editorState.blocks.reduce((count, block) => {
    return collapsedBlockIds.has(block.id) ? count + 1 : count;
  }, 0), [collapsedBlockIds, editorState.blocks]);
  const allBlocksCollapsed = editorState.blocks.length > 0 && collapsedActiveBlockCount === editorState.blocks.length;
  const hasCollapsedBlocks = collapsedActiveBlockCount > 0;

  const handleToggleBlockCollapsed = (blockId: string) => {
    setCollapsedBlockIds((current) => {
      const next = new Set(current);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  };

  const handleCollapseAllBlocks = () => {
    setCollapsedBlockIds(new Set(editorState.blocks.map((block) => block.id)));
  };

  const handleExpandAllBlocks = () => {
    setCollapsedBlockIds(new Set());
  };

  const handleRemoveBlockClick = (blockId: string) => {
    setCollapsedBlockIds((current) => {
      if (!current.has(blockId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(blockId);
      return next;
    });

    onRemoveBlock(blockId);
  };

  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      if (event.data?.type !== "pressplay-preview-metrics") {
        return;
      }

      const iframeWindow = previewIframeRef.current?.contentWindow;
      if (!iframeWindow || event.source !== iframeWindow) {
        return;
      }

      const visualHeight = Number(event.data.visualHeight);
      const visualWidth = Number(event.data.visualWidth);
      const flowHeight = Number(event.data.flowHeight);
      const scrollTop = Number(event.data.scrollTop);
      const maxScrollTop = Number(event.data.maxScrollTop);
      const scale = Number(event.data.scale);
      const viewportHeight = Number(event.data.viewportHeight);
      const viewportLockedLayout = event.data.viewportLockedLayout === true;
      if (
        !Number.isFinite(visualHeight)
        || !Number.isFinite(visualWidth)
        || !Number.isFinite(flowHeight)
        || !Number.isFinite(scrollTop)
        || !Number.isFinite(maxScrollTop)
        || !Number.isFinite(scale)
        || !Number.isFinite(viewportHeight)
      ) {
        return;
      }

      setPreviewMetrics((current) => {
        if (
          current
          && current.visualHeight === visualHeight
          && current.visualWidth === visualWidth
          && current.flowHeight === flowHeight
          && current.scrollTop === scrollTop
          && current.maxScrollTop === maxScrollTop
          && current.scale === scale
          && current.viewportHeight === viewportHeight
          && current.viewportLockedLayout === viewportLockedLayout
        ) {
          return current;
        }

        return {
          visualHeight,
          visualWidth,
          flowHeight,
          scrollTop,
          maxScrollTop,
          scale,
          viewportHeight,
          viewportLockedLayout,
        };
      });
      const nextScrollPercent = maxScrollTop > 0
        ? Math.round((scrollTop / maxScrollTop) * 100)
        : 0;
      setPreviewScrollPercent((current) => (current === nextScrollPercent ? current : nextScrollPercent));
    };

    window.addEventListener("message", handleWindowMessage);
    return () => {
      window.removeEventListener("message", handleWindowMessage);
    };
  }, []);

  const postPreviewState = useCallback((scrollPercent: number) => {
    previewIframeRef.current?.contentWindow?.postMessage({
      type: "pressplay-preview-set-state",
      scrollProgress: scrollPercent / 100,
    }, "*");
  }, []);

  const postPreviewScrollDelta = useCallback((deltaY: number) => {
    previewIframeRef.current?.contentWindow?.postMessage({
      type: "pressplay-preview-scroll-delta",
      deltaY,
    }, "*");
  }, []);

  const requestPreviewMetrics = useCallback(() => {
    previewIframeRef.current?.contentWindow?.postMessage({
      type: "pressplay-preview-request-metrics",
    }, "*");
  }, []);

  useEffect(() => {
    postPreviewState(previewScrollPercent);
  }, [postPreviewState, previewScrollPercent]);

  const clearPreviewSyncTimeouts = useCallback(() => {
    for (const timeoutId of previewSyncTimeoutIdsRef.current) {
      window.clearTimeout(timeoutId);
    }
    previewSyncTimeoutIdsRef.current = [];
  }, []);

  const scheduleInitialPreviewSync = useCallback(() => {
    clearPreviewSyncTimeouts();
    const retryDelaysMs = [0, 120, 360, 900];
    previewSyncTimeoutIdsRef.current = retryDelaysMs.map((delayMs) => {
      return window.setTimeout(() => {
        requestPreviewMetrics();
      }, delayMs);
    });
  }, [clearPreviewSyncTimeouts, requestPreviewMetrics]);

  useEffect(() => {
    return () => {
      clearPreviewSyncTimeouts();
    };
  }, [clearPreviewSyncTimeouts]);

  const effectivePreviewAspectRatio = useMemo(() => {
    if (hasPreviewAspectRatio) {
      return previewViewportAspectRatio;
    }

    if (previewMode === "overlay") {
      return "9 / 16";
    }

    return null;
  }, [hasPreviewAspectRatio, previewMode, previewViewportAspectRatio]);

  const fitPreviewHeight = useMemo(() => {
    if (!fitPreviewToContent || !previewMetrics || previewMetrics.maxScrollTop > 1) {
      return null;
    }

    const baseHeight = previewMetrics.visualHeight + 24;
    return Math.max(220, Math.min(760, baseHeight));
  }, [fitPreviewToContent, previewMetrics]);

  const inferredViewportLockedLayout = useMemo(() => {
    return /position\s*:\s*(fixed|sticky)/i.test(iframeDocument);
  }, [iframeDocument]);
  const hasViewportLockedPreview = (previewMetrics?.maxScrollTop ?? 0) > 1;
  const hasViewportLockedLayout = previewMetrics?.viewportLockedLayout ?? inferredViewportLockedLayout;
  const hasPopupStylePreview = hasViewportLockedLayout
    && (previewMetrics?.maxScrollTop ?? 0) <= 1;
  const usesOverlayViewportFallback = hasPopupStylePreview && previewMode === "overlay";
  const usesSectionViewportFallback = hasPopupStylePreview && previewMode === "section";
  const isPreviewLoaded = loadedIframeDocument === iframeDocument;
  const canFitPreviewToContent = !hasViewportLockedPreview;

  const previewCanvasStyle = useMemo(() => {
    const baseStyle: CSSProperties = {};

    if (previewMode === "overlay" || usesOverlayViewportFallback) {
      baseStyle.width = "min(100%, 26rem)";
      baseStyle.maxWidth = "100%";
      baseStyle.height = fitPreviewHeight !== null ? `${fitPreviewHeight}px` : "min(100%, 42rem)";
      baseStyle.maxHeight = "100%";
      baseStyle.borderRadius = "1rem";
      baseStyle.overflow = "hidden";
      baseStyle.boxShadow = "0 18px 40px rgba(50, 44, 34, 0.18)";
      baseStyle.border = "1px solid color-mix(in srgb, var(--color-timber) 52%, transparent)";
      baseStyle.background = "#ffffff";

      if (effectivePreviewAspectRatio) {
        baseStyle.aspectRatio = effectivePreviewAspectRatio;
        baseStyle.height = fitPreviewHeight !== null ? `${fitPreviewHeight}px` : "auto";
      }

      return baseStyle;
    }

    if (usesSectionViewportFallback) {
      baseStyle.width = "100%";
      baseStyle.height = "min(100%, 42rem)";
      baseStyle.maxWidth = "100%";
      baseStyle.maxHeight = "100%";
      baseStyle.borderRadius = "1rem";
      baseStyle.overflow = "hidden";
      baseStyle.border = "1px solid color-mix(in srgb, var(--color-timber) 52%, transparent)";
      baseStyle.boxShadow = "0 18px 40px rgba(50, 44, 34, 0.12)";
      baseStyle.background = "#ffffff";
      return baseStyle;
    }

    if (hasViewportLockedPreview) {
      baseStyle.width = "100%";
      baseStyle.height = "min(100%, 42rem)";
      baseStyle.maxWidth = "100%";
      baseStyle.maxHeight = "100%";
      baseStyle.borderRadius = "0";
      baseStyle.overflow = "hidden";
      baseStyle.border = "1px solid color-mix(in srgb, var(--color-timber) 52%, transparent)";
      baseStyle.boxShadow = "none";
      baseStyle.background = "#111111";
      return baseStyle;
    }

    if (effectivePreviewAspectRatio) {
      baseStyle.aspectRatio = effectivePreviewAspectRatio;
      baseStyle.height = fitPreviewHeight !== null ? `${fitPreviewHeight}px` : "100%";
      baseStyle.width = "auto";
      baseStyle.maxHeight = "100%";
      baseStyle.maxWidth = "100%";
      return baseStyle;
    }

    baseStyle.width = "100%";
    baseStyle.height = fitPreviewHeight !== null ? `${fitPreviewHeight}px` : "100%";
    return baseStyle;
  }, [
    effectivePreviewAspectRatio,
    fitPreviewHeight,
    hasViewportLockedPreview,
    previewMode,
    usesOverlayViewportFallback,
    usesSectionViewportFallback,
  ]);

  const previewStageClassName = hasViewportLockedPreview
    ? "flex h-full w-full items-start justify-stretch overflow-hidden p-0"
    : previewMode === "overlay" || usesOverlayViewportFallback
      ? "flex h-full w-full items-center justify-center overflow-hidden p-4"
    : usesSectionViewportFallback
      ? "flex h-full w-full items-start justify-stretch overflow-hidden p-4"
    : effectivePreviewAspectRatio || fitPreviewHeight !== null
      ? "flex h-full w-full items-start justify-center overflow-hidden p-3"
      : "h-full w-full overflow-hidden";
  const canDrivePreviewScroll = previewError === null;
  const hasScrollablePreviewRange = (previewMetrics?.maxScrollTop ?? 0) > 1;
  const previewScrollLabel = hasScrollablePreviewRange
      ? `${previewScrollPercent}%`
      : previewMetrics === null
        ? isPreviewLoaded
          ? "Preview ready"
          : "Preview loading"
        : !canDrivePreviewScroll
          ? "Preview unavailable"
        : fitPreviewToContent && !canFitPreviewToContent
          ? "Fit disabled for scroll layout"
        : fitPreviewToContent
          ? "Disabled while fitting"
          : "No scroll range";

  useEffect(() => {
    const handleWindowWheel = (event: WheelEvent) => {
      if (!canDrivePreviewScroll || !hasScrollablePreviewRange) {
        return;
      }

      const iframe = previewIframeRef.current;
      if (!iframe) {
        return;
      }

      const rect = iframe.getBoundingClientRect();
      const withinHorizontalBounds = event.clientX >= rect.left && event.clientX <= rect.right;
      const withinVerticalBounds = event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!withinHorizontalBounds || !withinVerticalBounds) {
        return;
      }

      event.preventDefault();
      postPreviewScrollDelta(event.deltaY);
    };

    window.addEventListener("wheel", handleWindowWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", handleWindowWheel);
    };
  }, [canDrivePreviewScroll, hasScrollablePreviewRange, postPreviewScrollDelta]);

  useEffect(() => {
    if (!canFitPreviewToContent && fitPreviewToContent) {
      onFitPreviewToContentChange(false);
    }
  }, [canFitPreviewToContent, fitPreviewToContent, onFitPreviewToContentChange]);

  const handleOpenFullPreview = useCallback(() => {
    if (previewError) {
      setFullPreviewError("Resolve the preview error before opening full preview.");
      return;
    }

    try {
      const previewWindow = window.open("", "_blank");
      if (!previewWindow) {
        setFullPreviewError("The browser blocked the full preview tab. Allow pop-ups and try again.");
        return;
      }

      previewWindow.document.open();
      previewWindow.document.write(getFullPreviewDocument());
      previewWindow.document.close();
      previewWindow.document.title = previewTitle?.trim() || schema.name || "Preview";
      setFullPreviewError(null);
    } catch (error) {
      setFullPreviewError(error instanceof Error ? error.message : "Failed to open full preview.");
    }
  }, [getFullPreviewDocument, previewError, previewTitle, schema.name]);

  const handlePreviewScrollChange = (
    event: ReactChangeEvent<HTMLInputElement> | ReactFormEvent<HTMLInputElement>,
  ) => {
    setPreviewScrollPercent(Number(event.currentTarget.value));
  };

  return (
    <div
      ref={workspaceRef}
      data-testid="sandbox-workspace"
      className="sandbox-workspace grid h-full min-h-0 gap-3"
      style={workspaceStyle}
    >
      <section
        data-testid="sandbox-editor-pane"
        className="sandbox-card-soft min-h-0 h-full min-w-0 overflow-auto p-3"
        style={{ contain: "layout paint style" }}
      >
        <div className="space-y-4">
          <div className="sandbox-card p-3">
            <h2 className="sandbox-title text-sm font-semibold">Section Settings</h2>
            <p className="sandbox-muted mt-1 text-xs">
              Unsupported/simulated controls: {sectionUnsupportedSettingsCount}
            </p>
          </div>

          {schema.editorEntries.length === 0 ? (
            <div className="sandbox-card p-3 text-sm" style={{ color: "var(--color-bark)" }}>
              No section settings were found in schema.
            </div>
          ) : (
            schema.editorEntries.map((entry, settingIndex) => {
              if (entry.kind === "presentation") {
                return renderPresentationEntry(entry.presentation, `section:presentation:${settingIndex}`);
              }

              const setting = entry.setting;
              return renderEditorEntry(
                entry,
                `${setting.id}:${settingIndex}`,
                editorState.sectionSettings[setting.id] ?? "",
                getSectionSettingPath(setting.id),
                getConditionalVisibilityHints(
                  setting,
                  editorState.sectionSettings[setting.id],
                  editorState.sectionSettings,
                  sectionSettingLookup,
                ),
                onSettingValueChange,
                onSelectLocalMedia,
              );
            })
          )}

          {hasBlockControls ? (
            <>
              <div className="sandbox-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="sandbox-title text-sm font-semibold">Blocks</h2>
                    <p className="sandbox-muted mt-1 text-xs">
                      Unsupported/simulated block settings: {blockUnsupportedSettingsCount}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {schema.blocks.length > 0 ? (
                      <>
                        <select
                          value={pendingBlockType}
                          onChange={(event) => onPendingBlockTypeChange(event.target.value)}
                          className="sandbox-input sandbox-focus-ring h-11 min-w-[11rem] px-3 text-xs"
                        >
                          {schema.blocks.map((block) => (
                            <option key={block.type} value={block.type}>
                              {getPlainLanguageSettingLabel(block.name)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!canAddSelectedBlock}
                          onClick={onAddBlock}
                          className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring h-11 px-3 text-xs"
                        >
                          Add block
                        </button>
                      </>
                    ) : null}
                    {editorState.blocks.length > 0 ? (
                      <>
                        <button
                          type="button"
                          disabled={allBlocksCollapsed}
                          onClick={handleCollapseAllBlocks}
                          className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring h-11 px-3 text-xs"
                        >
                          Collapse all
                        </button>
                        <button
                          type="button"
                          disabled={!hasCollapsedBlocks}
                          onClick={handleExpandAllBlocks}
                          className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring h-11 px-3 text-xs"
                        >
                          Expand all
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {editorState.blocks.map((block, index) => {
                const definition = blockDefinitionByType.get(block.type);
                const settingLookup = blockSettingLookupByType.get(block.type) ?? EMPTY_SETTING_LOOKUP;
                const isCollapsed = collapsedBlockIds.has(block.id);
                const blockLabel = getPlainLanguageSettingLabel(definition?.name ?? block.type);
                return (
                  <div key={block.id} data-testid="sandbox-block-card" className="sandbox-card min-w-0 p-3">
                    <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <p className="sandbox-title min-w-0 text-sm font-semibold">
                        Block {index + 1}: {blockLabel}
                      </p>
                      <div
                        data-testid="sandbox-block-actions"
                        className="flex max-w-full flex-wrap items-center gap-1 sm:justify-end"
                      >
                        <button
                          type="button"
                          onClick={() => handleToggleBlockCollapsed(block.id)}
                          className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring h-11 rounded-full px-3 text-xs"
                          aria-expanded={!isCollapsed}
                        >
                          {isCollapsed ? "Expand" : "Collapse"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveBlock(block.id, "up")}
                          disabled={index === 0}
                          className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring h-11 rounded-full px-3 text-xs"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveBlock(block.id, "down")}
                          disabled={index === editorState.blocks.length - 1}
                          className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring h-11 rounded-full px-3 text-xs"
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveBlockClick(block.id)}
                          className="sandbox-btn sandbox-btn-danger sandbox-focus-ring h-11 rounded-full px-3 text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {isCollapsed ? (
                      <p className="sandbox-muted text-xs">
                        Settings hidden. Expand to edit this block.
                      </p>
                    ) : (
                      <div data-testid="sandbox-block-settings" className="space-y-3">
                        {(definition?.editorEntries ?? []).map((entry, settingIndex) => {
                          if (entry.kind === "presentation") {
                            return renderPresentationEntry(
                              entry.presentation,
                              `${block.id}:presentation:${settingIndex}`,
                            );
                          }

                          const setting = entry.setting;
                          return renderEditorEntry(
                            entry,
                            `${block.id}:${setting.id}:${settingIndex}`,
                            block.settings[setting.id] ?? "",
                            getBlockSettingPath(block.id, setting.id),
                            getConditionalVisibilityHints(
                              setting,
                              block.settings[setting.id],
                              block.settings,
                              settingLookup,
                            ),
                            onSettingValueChange,
                            onSelectLocalMedia,
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : null}

          {diagnostics.length > 0 ? (
            <div className="sandbox-card-warn p-3">
              <h3 className="text-sm font-semibold" style={{ color: "#704322" }}>
                Schema Diagnostics
              </h3>
              <ul className="mt-2 space-y-1 text-xs" style={{ color: "#704322" }}>
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
        onPointerDown={onSplitterPointerDown}
        onKeyDown={onSplitterKeyDown}
        className="sandbox-splitter sandbox-focus-ring relative z-10 flex h-full w-full cursor-col-resize touch-none select-none items-center justify-center"
        style={{
          contain: "layout paint style",
          willChange: isResizing ? "transform" : "auto",
          transform: isResizing ? "translateZ(0)" : "none",
        }}
        title="Drag to resize panels"
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-flex h-12 w-6 flex-col items-center justify-center rounded-lg border ${
            isResizing ? "text-white" : "sandbox-muted"
          }`}
          style={{
            borderColor: isResizing
              ? "color-mix(in srgb, var(--color-moss) 70%, var(--color-timber))"
              : "color-mix(in srgb, var(--color-bark) 20%, var(--color-timber))",
            background: isResizing
              ? "color-mix(in srgb, var(--color-moss) 60%, var(--color-card))"
              : "var(--color-card)",
          }}
        >
          <span className="text-[11px] font-semibold leading-none">⇆</span>
          <span className="mt-1 grid grid-cols-2 gap-0.5">
            <span className="h-[3px] w-[3px] rounded-full bg-current/70" />
            <span className="h-[3px] w-[3px] rounded-full bg-current/70" />
            <span className="h-[3px] w-[3px] rounded-full bg-current/70" />
            <span className="h-[3px] w-[3px] rounded-full bg-current/70" />
          </span>
        </span>
      </div>

      <section
        data-testid="sandbox-preview-pane"
        className="sandbox-card flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ contain: "layout paint style" }}
      >
        <header
          className="px-4 py-3"
          style={{ borderBottom: "1px solid color-mix(in srgb, var(--color-timber) 58%, transparent)" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="sandbox-title text-sm font-semibold">Preview</h2>
              {previewError ? <p className="mt-1 text-xs" style={{ color: "#8f2f29" }}>{previewError}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleOpenFullPreview}
                className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring h-9 px-3 text-xs"
              >
                Open Full Preview
              </button>
              <label className="sandbox-muted flex items-center gap-2 text-xs">
                <span className="font-semibold">Mode</span>
                <select
                  value={previewMode}
                  onChange={(event) => onPreviewModeChange(event.target.value as PreviewMode)}
                  className="sandbox-input sandbox-focus-ring h-9 min-w-[8.5rem] px-3 text-xs"
                >
                  <option value="section">Section</option>
                  <option value="overlay">Overlay</option>
                </select>
              </label>
              <label className="sandbox-muted flex items-center gap-2 rounded-full border px-3 py-2 text-xs"
                style={{ borderColor: "color-mix(in srgb, var(--color-timber) 52%, transparent)" }}
              >
                <input
                  type="checkbox"
                  checked={fitPreviewToContent}
                  disabled={!canFitPreviewToContent}
                  onChange={(event) => onFitPreviewToContentChange(event.target.checked)}
                />
                <span className="font-semibold">Fit Content</span>
              </label>
            </div>
          </div>
          {hasViewportLockedPreview ? (
            <p className="sandbox-card-warn mt-3 px-3 py-2 text-xs" style={{ borderRadius: "0.85rem", color: "#704322" }}>
              This section uses scroll-driven or sticky layout behavior. Use Full Preview for accurate interaction validation.
            </p>
          ) : null}
          {fullPreviewError ? (
            <p className="mt-3 text-xs" style={{ color: "#8f2f29" }}>{fullPreviewError}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="sandbox-muted flex min-w-[16rem] flex-1 items-center gap-3 text-xs">
              <span className="min-w-[5rem] font-semibold">Scroll</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={previewScrollPercent}
                disabled={!canDrivePreviewScroll}
                onChange={handlePreviewScrollChange}
                onInput={handlePreviewScrollChange}
                className="flex-1 accent-[var(--color-moss)]"
                aria-label="Scroll Progress"
              />
            </label>
            <button
              type="button"
              onClick={() => setPreviewScrollPercent(0)}
              disabled={previewScrollPercent === 0}
              className="sandbox-btn sandbox-btn-secondary sandbox-focus-ring h-9 px-3 text-xs"
            >
              Reset Scroll
            </button>
            <span className="sandbox-muted text-xs">{previewScrollLabel}</span>
          </div>
        </header>
        <div className="min-h-0 w-full flex-1">
          <div
            className={previewStageClassName}
            data-testid="sandbox-preview-stage"
          >
            <div className="max-h-full max-w-full" style={previewCanvasStyle}>
              <iframe
                ref={previewIframeRef}
                title="Component preview"
                srcDoc={iframeDocument}
                onLoad={() => {
                  setLoadedIframeDocument(iframeDocument);
                  setPreviewMetrics(null);
                  setPreviewScrollPercent(0);
                  scheduleInitialPreviewSync();
                }}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                className={`h-full w-full border-0 ${previewMode === "overlay" ? "bg-white" : ""} ${
                  effectivePreviewAspectRatio || previewMode === "overlay" ? "rounded-md" : ""
                }`}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
