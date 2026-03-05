"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { SandboxWorkspace } from "@/app/components/[id]/sandbox/SandboxWorkspace";
import {
  KEYBOARD_SPLIT_STEP_PERCENT,
  MAX_SPLIT_PERCENT,
  MIN_SPLIT_PERCENT,
  PREVIEW_ENQUEUE_DEBOUNCE_MS,
  applyMediaOverrides,
  buildPreviewDocument,
  clampSplitPercent,
  parseSettingPath,
} from "@/app/components/[id]/sandbox/sandbox-helpers";

import { renderLiquidPreview } from "@/lib/liquid/render";
import { applyLiquidPreviewFallbacks } from "@/lib/liquid/preview-fallbacks";
import { parseLiquidSchema } from "@/lib/liquid/schema-parse";
import { buildInitialEditorState, createBlockInstanceFromDefinition, patchLiquidSchemaDefaults } from "@/lib/liquid/schema-patch";
import { buildSettingLookup } from "@/lib/liquid/visibility-hints";
import type {
  LiquidEditorState,
  LiquidSchema,
  LiquidSchemaDiagnostic,
  LiquidSchemaSetting,
  LiquidSettingJsonValue,
} from "@/lib/liquid/schema-types";

const MAX_RECORDING_FRAME_RATE = 30;
const THUMBNAIL_MAX_BYTES = 25 * 1024 * 1024;
const RECORDING_MAX_BYTES = 24 * 1024 * 1024;
const RECORDING_MAX_DURATION_MS = 30_000;
const PREVIEW_PLACEHOLDER_TEXT = "Select a .liquid file above to load split-view controls and preview.";

const RECORDING_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

type UploadedComponent = {
  id: string;
  title: string;
  category: string;
  thumbnail_path: string;
  file_path: string;
  created_at: string;
  updated_at: string;
};

type UploadSuccessResponse = {
  component: UploadedComponent;
  requestId: string;
};

type UploadErrorResponse = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

type UploadFormProps = {
  onUploaded?: (component: UploadedComponent) => void;
};

function getPreferredRecordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  for (const mimeType of RECORDING_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null;
}

function getRecordingExtension(mimeType: string): ".mp4" | ".webm" {
  if (mimeType.includes("mp4")) {
    return ".mp4";
  }

  return ".webm";
}

function assignFileToInput(input: HTMLInputElement | null, file: File): boolean {
  if (!input) {
    return false;
  }

  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

export function UploadForm({ onUploaded }: UploadFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [uploadedComponent, setUploadedComponent] = useState<UploadedComponent | null>(null);

  const [localLiquidSource, setLocalLiquidSource] = useState("");
  const [localLiquidFileName, setLocalLiquidFileName] = useState<string | null>(null);
  const [schema, setSchema] = useState<LiquidSchema | null>(null);
  const [diagnostics, setDiagnostics] = useState<LiquidSchemaDiagnostic[]>([]);
  const [editorState, setEditorState] = useState<LiquidEditorState | null>(null);
  const [pendingBlockType, setPendingBlockType] = useState<string>("");
  const [mediaOverrides, setMediaOverrides] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [splitPercent, setSplitPercent] = useState(44);
  const [isResizing, setIsResizing] = useState(false);
  const [isRecordingPreview, setIsRecordingPreview] = useState(false);
  const [recordingMessage, setRecordingMessage] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const localFileLoadTokenRef = useRef(0);
  const inFlightControllerRef = useRef<AbortController | null>(null);
  const previewRenderControllerRef = useRef<AbortController | null>(null);
  const previewDebounceTimerRef = useRef<number | null>(null);
  const liquidInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingBytesRef = useRef(0);
  const recordingStopReasonRef = useRef<"manual" | "max_size" | "max_duration" | null>(null);
  const recordingStartInFlightRef = useRef(false);
  const recordingAutoStopTimerRef = useRef<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const blockIdCounterRef = useRef(0);
  const activePointerIdRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const resizePendingPercentRef = useRef<number | null>(null);
  const resizeBoundsRef = useRef<{ left: number; width: number } | null>(null);
  const liveSplitPercentRef = useRef(splitPercent);
  const mediaOverridesRef = useRef<Record<string, string>>(mediaOverrides);

  const previewDocument = useMemo(() => buildPreviewDocument(previewHtml), [previewHtml]);
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

  const blockDefinitionByType = useMemo(() => {
    const map = new Map<string, LiquidSchema["blocks"][number]>();
    for (const definition of schema?.blocks ?? []) {
      map.set(definition.type, definition);
    }
    return map;
  }, [schema]);

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

  const sectionSettingLookup = useMemo(() => buildSettingLookup(schema?.settings ?? []), [schema]);
  const blockSettingLookupByType = useMemo(() => {
    const map = new Map<string, Map<string, LiquidSchemaSetting>>();
    for (const definition of schema?.blocks ?? []) {
      map.set(definition.type, buildSettingLookup(definition.settings));
    }
    return map;
  }, [schema]);

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

  function clearRecordingAutoStopTimer() {
    if (recordingAutoStopTimerRef.current === null) {
      return;
    }

    window.clearTimeout(recordingAutoStopTimerRef.current);
    recordingAutoStopTimerRef.current = null;
  }

  function stopDisplayStreamTracks() {
    const displayStream = displayStreamRef.current;
    if (!displayStream) {
      return;
    }

    for (const track of displayStream.getTracks()) {
      track.stop();
    }

    displayStreamRef.current = null;
  }

  function clearPreviewDebounceTimer() {
    if (previewDebounceTimerRef.current === null) {
      return;
    }

    window.clearTimeout(previewDebounceTimerRef.current);
    previewDebounceTimerRef.current = null;
  }

  function revokeMediaOverrideUrls(overrides: Record<string, string>) {
    for (const value of Object.values(overrides)) {
      if (value.startsWith("blob:")) {
        URL.revokeObjectURL(value);
      }
    }
  }

  function resetPreviewAndRecordingState() {
    localFileLoadTokenRef.current += 1;
    setLocalLiquidSource("");
    setLocalLiquidFileName(null);
    setSchema(null);
    setDiagnostics([]);
    setEditorState(null);
    setPendingBlockType("");
    setMediaOverrides({});
    setPreviewHtml("");
    setPreviewError(null);
    setIsRenderingPreview(false);
    setSplitPercent(44);
    setIsResizing(false);
    setIsRecordingPreview(false);
    setRecordingMessage(null);
    setRecordingError(null);

    clearPreviewDebounceTimer();
    previewRenderControllerRef.current?.abort();
    previewRenderControllerRef.current = null;
    blockIdCounterRef.current = 0;
    activePointerIdRef.current = null;
    resizeBoundsRef.current = null;
    resizePendingPercentRef.current = null;
    liveSplitPercentRef.current = 44;
    revokeMediaOverrideUrls(mediaOverridesRef.current);
    mediaOverridesRef.current = {};

    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingBytesRef.current = 0;
    recordingStopReasonRef.current = null;
    recordingStartInFlightRef.current = false;

    clearRecordingAutoStopTimer();

    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }

    stopDisplayStreamTracks();
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      inFlightControllerRef.current?.abort();
      inFlightControllerRef.current = null;

      clearPreviewDebounceTimer();
      previewRenderControllerRef.current?.abort();
      previewRenderControllerRef.current = null;

      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (recorder && recorder.state === "recording") {
        recorder.stop();
      }

      recordingChunksRef.current = [];
      recordingBytesRef.current = 0;
      recordingStopReasonRef.current = null;
      recordingStartInFlightRef.current = false;
      clearRecordingAutoStopTimer();
      stopDisplayStreamTracks();

      revokeMediaOverrideUrls(mediaOverridesRef.current);
      mediaOverridesRef.current = {};
    };
  }, []);

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

  async function loadLiquidFileForPreview(file: File | null) {
    const token = localFileLoadTokenRef.current + 1;
    localFileLoadTokenRef.current = token;

    if (!file) {
      revokeMediaOverrideUrls(mediaOverridesRef.current);
      mediaOverridesRef.current = {};
      setMediaOverrides({});
      setLocalLiquidSource("");
      setLocalLiquidFileName(null);
      setSchema(null);
      setDiagnostics([]);
      setEditorState(null);
      setPendingBlockType("");
      setPreviewHtml("");
      setPreviewError(null);
      return;
    }

    try {
      const source = await file.text();
      if (!isMountedRef.current || localFileLoadTokenRef.current !== token) {
        return;
      }

      const parsedResult = parseLiquidSchema(source);
      const initialState = parsedResult.schema ? buildInitialEditorState(parsedResult.schema) : null;
      const primaryDiagnostic = parsedResult.diagnostics.find((diagnostic) => diagnostic.level === "error")
        ?? parsedResult.diagnostics[0];

      revokeMediaOverrideUrls(mediaOverridesRef.current);
      mediaOverridesRef.current = {};
      setMediaOverrides({});
      setLocalLiquidSource(source);
      setLocalLiquidFileName(file.name);
      setSchema(parsedResult.schema);
      setDiagnostics(parsedResult.diagnostics);
      setEditorState(initialState);
      setPendingBlockType(parsedResult.schema?.blocks[0]?.type ?? "");
      blockIdCounterRef.current = initialState?.blocks.length ?? 0;
      setPreviewHtml("");
      setPreviewError(parsedResult.schema ? null : (primaryDiagnostic?.message ?? "Liquid schema parsing failed."));
      setRecordingMessage(null);
      setRecordingError(null);
    } catch {
      if (!isMountedRef.current || localFileLoadTokenRef.current !== token) {
        return;
      }

      setLocalLiquidSource("");
      setLocalLiquidFileName(file.name);
      setSchema(null);
      setDiagnostics([]);
      setEditorState(null);
      setPendingBlockType("");
      setPreviewHtml("");
      setPreviewError("Failed to read selected Liquid file.");
    }
  }

  function handleLiquidFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    void loadLiquidFileForPreview(file);
  }

  useEffect(() => {
    mediaOverridesRef.current = mediaOverrides;
  }, [mediaOverrides]);

  useEffect(() => {
    if (!localLiquidSource || !effectiveEditorState) {
      setIsRenderingPreview(false);
      setPreviewHtml("");
      return;
    }

    clearPreviewDebounceTimer();
    const controller = new AbortController();
    previewRenderControllerRef.current?.abort();
    previewRenderControllerRef.current = controller;

    setIsRenderingPreview(true);

    previewDebounceTimerRef.current = window.setTimeout(() => {
      previewDebounceTimerRef.current = null;
      void (async () => {
        try {
          const result = await renderLiquidPreview(localLiquidSource, effectiveEditorState, controller.signal);

          if (!isMountedRef.current || previewRenderControllerRef.current !== controller) {
            return;
          }

          setPreviewHtml(result.html);
          setPreviewError(null);
        } catch (error) {
          if (!isMountedRef.current || previewRenderControllerRef.current !== controller) {
            return;
          }

          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }

          if (error instanceof Error && error.name === "AbortError") {
            return;
          }

          setPreviewHtml("");
          setPreviewError(error instanceof Error ? error.message : "Failed to render local preview.");
        } finally {
          if (previewRenderControllerRef.current === controller) {
            previewRenderControllerRef.current = null;
          }

          if (isMountedRef.current) {
            setIsRenderingPreview(false);
          }
        }
      })();
    }, PREVIEW_ENQUEUE_DEBOUNCE_MS);

    return () => {
      clearPreviewDebounceTimer();
      controller.abort();
    };
  }, [effectiveEditorState, localLiquidSource]);

  useEffect(() => {
    if (!workspaceRef.current) {
      return;
    }

    workspaceRef.current.style.setProperty("--sandbox-left-pane", `${splitPercent}%`);
    liveSplitPercentRef.current = splitPercent;
  }, [splitPercent]);

  async function handleStartRecordingPreview() {
    if (isRecordingPreview || recordingStartInFlightRef.current) {
      return;
    }

    recordingStartInFlightRef.current = true;

    if (!previewHtml.trim()) {
      setRecordingError("Load a valid Liquid file and wait for preview before starting a recording.");
      recordingStartInFlightRef.current = false;
      return;
    }

    if (
      typeof window === "undefined"
      || typeof MediaRecorder === "undefined"
      || !navigator.mediaDevices
      || !navigator.mediaDevices.getDisplayMedia
    ) {
      setRecordingError("This browser does not support preview recording.");
      recordingStartInFlightRef.current = false;
      return;
    }

    setRecordingError(null);
    setRecordingMessage("Choose this browser tab/window in the screen-share picker.");

    const preferredMimeType = getPreferredRecordingMimeType();

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: MAX_RECORDING_FRAME_RATE,
            max: MAX_RECORDING_FRAME_RATE,
          },
        },
        audio: false,
      });

      if (!isMountedRef.current) {
        for (const track of displayStream.getTracks()) {
          track.stop();
        }
        recordingStartInFlightRef.current = false;
        return;
      }

      stopDisplayStreamTracks();
      displayStreamRef.current = displayStream;
      recordingChunksRef.current = [];
      recordingBytesRef.current = 0;
      recordingStopReasonRef.current = null;

      const recorderOptions: MediaRecorderOptions = preferredMimeType
        ? { mimeType: preferredMimeType }
        : {};

      const mediaRecorder = new MediaRecorder(displayStream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;

      for (const track of displayStream.getVideoTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (mediaRecorder.state === "recording") {
              mediaRecorder.stop();
            }
          },
          { once: true },
        );
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
          recordingBytesRef.current += event.data.size;

          if (recordingBytesRef.current > RECORDING_MAX_BYTES && mediaRecorder.state === "recording") {
            recordingStopReasonRef.current = "max_size";
            mediaRecorder.stop();
          }
        }
      };

      mediaRecorder.onerror = () => {
        if (!isMountedRef.current) {
          return;
        }

        recordingStartInFlightRef.current = false;
        clearRecordingAutoStopTimer();
        setIsRecordingPreview(false);
        setRecordingMessage(null);
        setRecordingError("Recording failed. Please try again.");
        mediaRecorderRef.current = null;
        recordingChunksRef.current = [];
        recordingBytesRef.current = 0;
        recordingStopReasonRef.current = null;
        stopDisplayStreamTracks();
      };

      mediaRecorder.onstop = () => {
        const stopReason = recordingStopReasonRef.current;
        recordingStopReasonRef.current = null;
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        recordingBytesRef.current = 0;
        recordingStartInFlightRef.current = false;
        clearRecordingAutoStopTimer();

        const mimeType = mediaRecorder.mimeType || preferredMimeType || "video/webm";

        mediaRecorderRef.current = null;
        stopDisplayStreamTracks();

        if (!isMountedRef.current) {
          return;
        }

        setIsRecordingPreview(false);

        if (chunks.length === 0) {
          setRecordingMessage(null);
          setRecordingError("No video data was captured.");
          return;
        }

        const recordingBlob = new Blob(chunks, { type: mimeType });
        const normalizedMimeType = recordingBlob.type || mimeType;
        const extension = getRecordingExtension(normalizedMimeType);
        const baseName = localLiquidFileName
          ? localLiquidFileName.replace(/\.liquid$/i, "")
          : "liquid-preview";

        const recordingFile = new File(
          [recordingBlob],
          `${baseName}-thumbnail${extension}`,
          {
            type: normalizedMimeType,
            lastModified: Date.now(),
          },
        );

        if (recordingFile.size > THUMBNAIL_MAX_BYTES) {
          setRecordingMessage(null);
          setRecordingError(
            `Recording exceeds the 25MB upload limit (${Math.ceil(recordingFile.size / 1024 / 1024)} MB). Record a shorter clip.`,
          );
          return;
        }

        const assigned = assignFileToInput(thumbnailInputRef.current, recordingFile);
        if (!assigned) {
          setRecordingMessage(null);
          setRecordingError(
            "Recording finished, but thumbnail input could not be auto-filled. Please pick the saved recording manually.",
          );
          return;
        }

        setRecordingError(null);
        const sizeLabel = `${Math.ceil(recordingFile.size / 1024)} KB`;
        if (stopReason === "max_duration") {
          setRecordingMessage(
            `Recording auto-stopped at ${Math.round(RECORDING_MAX_DURATION_MS / 1000)}s: ${recordingFile.name} (${sizeLabel}).`,
          );
          return;
        }

        if (stopReason === "max_size") {
          setRecordingMessage(
            `Recording auto-stopped near size limit: ${recordingFile.name} (${sizeLabel}).`,
          );
          return;
        }

        setRecordingMessage(`Recording ready: ${recordingFile.name} (${sizeLabel}).`);
      };

      mediaRecorder.start(250);
      recordingAutoStopTimerRef.current = window.setTimeout(() => {
        const activeRecorder = mediaRecorderRef.current;
        if (!activeRecorder || activeRecorder !== mediaRecorder || activeRecorder.state !== "recording") {
          return;
        }

        recordingStopReasonRef.current = "max_duration";
        activeRecorder.stop();
      }, RECORDING_MAX_DURATION_MS);
      setIsRecordingPreview(true);
      setRecordingMessage("Recording in progress. Click Stop Recording when done.");
      recordingStartInFlightRef.current = false;
    } catch (error) {
      recordingStartInFlightRef.current = false;
      clearRecordingAutoStopTimer();
      mediaRecorderRef.current = null;
      recordingChunksRef.current = [];
      recordingBytesRef.current = 0;
      recordingStopReasonRef.current = null;
      stopDisplayStreamTracks();

      if (!isMountedRef.current) {
        return;
      }

      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setRecordingError("Screen recording permission was denied.");
      } else {
        setRecordingError("Unable to start recording.");
      }

      setRecordingMessage(null);
    }
  }

  function handleStopRecordingPreview() {
    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder) {
      return;
    }

    if (mediaRecorder.state === "recording") {
      recordingStopReasonRef.current = "manual";
      mediaRecorder.stop();
      return;
    }

    setIsRecordingPreview(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || inFlightControllerRef.current) {
      return;
    }

    if (isRecordingPreview) {
      setErrorMessage("Stop preview recording before uploading.");
      return;
    }

    const controller = new AbortController();
    inFlightControllerRef.current = controller;

    setIsSubmitting(true);
    setErrorMessage(null);
    setRequestId(null);
    setUploadedComponent(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    const selectedLiquidFile = liquidInputRef.current?.files?.[0] ?? null;
    if (selectedLiquidFile && localLiquidSource.trim().length > 0) {
      const sourceForUpload = schema && editorState
        ? patchLiquidSchemaDefaults(localLiquidSource, schema, editorState)
        : localLiquidSource;

      const editedLiquidFile = new File([sourceForUpload], selectedLiquidFile.name, {
        type: selectedLiquidFile.type || "text/plain",
        lastModified: Date.now(),
      });
      formData.set("liquidFile", editedLiquidFile);
    }

    try {
      const response = await fetch("/api/admin/components", {
        method: "POST",
        headers: {
          "x-admin-csrf": "1",
        },
        body: formData,
        signal: controller.signal,
      });

      const body = (await response
        .json()
        .catch(() => null)) as UploadSuccessResponse | UploadErrorResponse | null;

      if (!isMountedRef.current) {
        return;
      }

      if (!response.ok) {
        const errorBody = body as UploadErrorResponse | null;
        setErrorMessage(errorBody?.error?.message ?? "Upload failed.");
        setRequestId(errorBody?.error?.requestId ?? null);
        return;
      }

      if (!body || !("component" in body)) {
        setErrorMessage("Upload completed but response was malformed.");
        return;
      }

      setUploadedComponent(body.component);
      setRequestId(body.requestId);
      onUploaded?.(body.component);
      form.reset();
      resetPreviewAndRecordingState();
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setErrorMessage("Upload request failed before completion.");
    } finally {
      if (inFlightControllerRef.current === controller) {
        inFlightControllerRef.current = null;
      }

      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-zinc-800">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={120}
            autoComplete="off"
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 transition-colors focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
          />
        </div>
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-zinc-800">
            Category
          </label>
          <input
            id="category"
            name="category"
            type="text"
            required
            maxLength={48}
            autoComplete="off"
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 transition-colors focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
          />
        </div>
      </div>

      <div>
        <label htmlFor="thumbnail" className="block text-sm font-medium text-zinc-800">
          Thumbnail (image or video)
        </label>
        <input
          ref={thumbnailInputRef}
          id="thumbnail"
          name="thumbnail"
          type="file"
          required
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm"
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
        />
      </div>

      <div>
        <label htmlFor="liquidFile" className="block text-sm font-medium text-zinc-800">
          Liquid File (.liquid)
        </label>
        <input
          ref={liquidInputRef}
          id="liquidFile"
          name="liquidFile"
          type="file"
          required
          accept=".liquid,text/plain,text/x-liquid,application/octet-stream"
          onChange={handleLiquidFileChange}
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
        />
      </div>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
            Split-View Liquid Editor + Recording
          </h2>
          <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600">
            Optional
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Reuses the same schema settings + block controls as sandbox. Configure the component visually, then record a
          short clip to auto-fill the thumbnail input.
        </p>

        {localLiquidFileName ? (
          <p className="mt-3 text-xs text-zinc-500">
            Loaded file: <span className="font-medium">{localLiquidFileName}</span>
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-600">
            {isRenderingPreview ? "Preview rendering…" : "Preview ready"}
          </span>

          {isRecordingPreview ? (
            <button
              type="button"
              onClick={handleStopRecordingPreview}
              className="touch-manipulation rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2"
            >
              Stop Recording
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleStartRecordingPreview()}
              disabled={isRenderingPreview || previewHtml.trim().length === 0 || !schema || !editorState}
              className="touch-manipulation rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start Recording
            </button>
          )}
        </div>

        {previewError && (!schema || !editorState) ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            {previewError}
          </div>
        ) : null}

        {recordingError ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {recordingError}
          </div>
        ) : null}

        {recordingMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
          >
            {recordingMessage}
          </div>
        ) : null}

        {!localLiquidSource ? (
          <div className="mt-3 flex h-44 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-center text-xs text-zinc-500">
            {PREVIEW_PLACEHOLDER_TEXT}
          </div>
        ) : !schema || !editorState ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            {previewError ?? "Liquid schema parsing failed."}
          </div>
        ) : (
          <div className="mt-3 h-[34rem] min-h-[26rem]">
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
              iframeDocument={previewDocument}
              onPendingBlockTypeChange={setPendingBlockType}
              onAddBlock={handleAddBlock}
              onMoveBlock={handleMoveBlock}
              onRemoveBlock={handleRemoveBlock}
              onSettingValueChange={handleSettingValueChange}
              onSelectLocalMedia={handleSelectLocalMedia}
              onSplitterPointerDown={handleSplitterPointerDown}
              onSplitterKeyDown={handleSplitterKeyDown}
            />
          </div>
        )}
      </section>

      {errorMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          <p>{errorMessage}</p>
          {requestId ? (
            <p className="mt-1 text-xs text-red-600">
              Request ID: <code>{requestId}</code>
            </p>
          ) : null}
        </div>
      ) : null}

      {uploadedComponent ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          <p className="font-medium">Upload succeeded: {uploadedComponent.title}</p>
          <p className="mt-1 text-xs">
            id: <code>{uploadedComponent.id}</code>
          </p>
          <p className="mt-1 text-xs">
            requestId: <code>{requestId}</code>
          </p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting || isRecordingPreview}
        className="touch-manipulation rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Uploading…" : "Upload Component"}
      </button>
    </form>
  );
}
