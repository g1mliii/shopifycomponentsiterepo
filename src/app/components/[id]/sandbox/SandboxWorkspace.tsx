"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";

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
  LiquidSchemaDiagnostic,
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
  scale: number;
  visualHeight: number;
  visualWidth: number;
};

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
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  const blockDefinitionByType = useMemo(() => {
    const map = new Map<string, LiquidSchema["blocks"][number]>();
    for (const definition of schema.blocks) {
      map.set(definition.type, definition);
    }
    return map;
  }, [schema.blocks]);

  const collapsedActiveBlockCount = editorState.blocks.reduce((count, block) => {
    return collapsedBlockIds.has(block.id) ? count + 1 : count;
  }, 0);
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

      if (!previewIframeRef.current?.contentWindow || event.source !== previewIframeRef.current.contentWindow) {
        return;
      }

      const visualHeight = Number(event.data.visualHeight);
      const visualWidth = Number(event.data.visualWidth);
      const flowHeight = Number(event.data.flowHeight);
      const scale = Number(event.data.scale);
      if (
        !Number.isFinite(visualHeight)
        || !Number.isFinite(visualWidth)
        || !Number.isFinite(flowHeight)
        || !Number.isFinite(scale)
      ) {
        return;
      }

      setPreviewMetrics({
        visualHeight,
        visualWidth,
        flowHeight,
        scale,
      });
    };

    window.addEventListener("message", handleWindowMessage);
    return () => {
      window.removeEventListener("message", handleWindowMessage);
    };
  }, []);

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
    if (!fitPreviewToContent || !previewMetrics) {
      return null;
    }

    const paddedHeight = previewMetrics.visualHeight + 24;
    return Math.max(220, Math.min(900, paddedHeight));
  }, [fitPreviewToContent, previewMetrics]);

  const previewCanvasStyle = useMemo(() => {
    const baseStyle: CSSProperties = {};

    if (previewMode === "overlay") {
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
  }, [effectivePreviewAspectRatio, fitPreviewHeight, previewMode]);

  const previewStageClassName = previewMode === "overlay"
    ? "flex h-full w-full items-center justify-center overflow-auto p-4"
    : effectivePreviewAspectRatio || fitPreviewHeight !== null
      ? "flex h-full w-full items-start justify-center overflow-auto p-3"
      : "h-full w-full overflow-auto";

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

          {schema.settings.length === 0 ? (
            <div className="sandbox-card p-3 text-sm" style={{ color: "var(--color-bark)" }}>
              No section settings were found in schema.
            </div>
          ) : (
            schema.settings.map((setting, settingIndex) => (
              <SettingControl
                key={`${setting.id}:${settingIndex}`}
                setting={setting}
                value={editorState.sectionSettings[setting.id] ?? ""}
                pathKey={getSectionSettingPath(setting.id)}
                conditionalHints={getConditionalVisibilityHints(
                  setting,
                  editorState.sectionSettings[setting.id],
                  editorState.sectionSettings,
                  sectionSettingLookup,
                )}
                onChange={onSettingValueChange}
                onSelectLocalMedia={onSelectLocalMedia}
              />
            ))
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
                        {(definition?.settings ?? []).map((setting, settingIndex) => (
                          <SettingControl
                            key={`${block.id}:${setting.id}:${settingIndex}`}
                            setting={setting}
                            value={block.settings[setting.id] ?? ""}
                            pathKey={getBlockSettingPath(block.id, setting.id)}
                            conditionalHints={getConditionalVisibilityHints(
                              setting,
                              block.settings[setting.id],
                              block.settings,
                              settingLookup,
                            )}
                            onChange={onSettingValueChange}
                            onSelectLocalMedia={onSelectLocalMedia}
                          />
                        ))}
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
                  onChange={(event) => onFitPreviewToContentChange(event.target.checked)}
                />
                <span className="font-semibold">Fit Content</span>
              </label>
            </div>
          </div>
        </header>
        <div className="min-h-0 w-full flex-1">
          <div className={previewStageClassName}>
            <div className="max-h-full max-w-full" style={previewCanvasStyle}>
              <iframe
                ref={previewIframeRef}
                title="Component preview"
                srcDoc={iframeDocument}
                onLoad={() => setPreviewMetrics(null)}
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
