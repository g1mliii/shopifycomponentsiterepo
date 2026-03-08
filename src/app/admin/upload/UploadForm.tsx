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
  LOCAL_MEDIA_PREVIEW_MAX_BYTES,
  MAX_SPLIT_PERCENT,
  MIN_SPLIT_PERCENT,
  PREVIEW_ENQUEUE_DEBOUNCE_MS,
  applyMediaOverrides,
  buildPreviewDocument,
  clampSplitPercent,
  parseSettingPath,
  readLocalMediaFileAsDataUrl,
} from "@/app/components/[id]/sandbox/sandbox-helpers";

import { renderLiquidPreview } from "@/lib/liquid/render";
import { applyLiquidPreviewFallbacks } from "@/lib/liquid/preview-fallbacks";
import { parseLiquidSchema } from "@/lib/liquid/schema-parse";
import { buildInitialEditorState, createBlockInstanceFromDefinition, patchLiquidSchemaDefaults } from "@/lib/liquid/schema-patch";
import {
  getUploadBlockingSchemaDiagnostics,
  getUploadBlockingSchemaMessage,
  getUploadSuggestionSchemaDiagnostics,
  getUploadSuggestionSchemaMessage,
} from "@/lib/liquid/upload-blocking-diagnostics";
import { parseUploadDraftSnapshot, UPLOAD_DRAFT_STORAGE_KEY, type UploadDraftSnapshot } from "@/lib/liquid/upload-draft";
import { buildSettingLookup } from "@/lib/liquid/visibility-hints";
import { validationLimits } from "@/lib/validation/upload-component";
import type {
  LiquidEditorState,
  LiquidSchema,
  LiquidSchemaDiagnostic,
  LiquidSchemaSetting,
  LiquidSettingJsonValue,
} from "@/lib/liquid/schema-types";

const PREVIEW_PLACEHOLDER_TEXT = "Select a .liquid file above to load split-view controls and preview.";
const LOCAL_MEDIA_PREVIEW_ERROR_PREFIX = "Local preview file";
const UPLOAD_DRAFT_PERSIST_DEBOUNCE_MS = 400;
const UPLOAD_DRAFT_PERSIST_IDLE_TIMEOUT_MS = 1_200;

type WindowWithIdleCallback = Window & typeof globalThis & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type UploadedComponent = {
  id: string;
  title: string;
  category: string;
  thumbnail_path: string | null;
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

function clearPersistedUploadDraft(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(UPLOAD_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore browser storage failures and keep the in-memory form usable.
  }
}

function persistUploadDraftSnapshot(serializedSnapshot: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (serializedSnapshot === null) {
      window.localStorage.removeItem(UPLOAD_DRAFT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(UPLOAD_DRAFT_STORAGE_KEY, serializedSnapshot);
  } catch {
    // Ignore storage write failures and keep the upload flow usable.
  }
}

async function prepareThumbnailUploadFileOnDemand(file: File) {
  const { prepareThumbnailUploadFile } = await import("@/lib/media/thumbnail-video-compression");
  return prepareThumbnailUploadFile(file);
}

export function UploadForm({ onUploaded }: UploadFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [uploadedComponent, setUploadedComponent] = useState<UploadedComponent | null>(null);
  const [isPreparingThumbnail, setIsPreparingThumbnail] = useState(false);
  const [thumbnailStatusMessage, setThumbnailStatusMessage] = useState<string | null>(null);
  const [titleValue, setTitleValue] = useState("");
  const [categoryValue, setCategoryValue] = useState("");
  const [draftStatusMessage, setDraftStatusMessage] = useState<string | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);

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

  const isMountedRef = useRef(true);
  const submitLockRef = useRef(false);
  const localFileLoadTokenRef = useRef(0);
  const inFlightControllerRef = useRef<AbortController | null>(null);
  const previewRenderControllerRef = useRef<AbortController | null>(null);
  const previewDebounceTimerRef = useRef<number | null>(null);
  const draftPersistTimerRef = useRef<number | null>(null);
  const draftPersistIdleCallbackRef = useRef<number | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const liquidInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const blockIdCounterRef = useRef(0);
  const activePointerIdRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const resizePendingPercentRef = useRef<number | null>(null);
  const resizeBoundsRef = useRef<{ left: number; width: number } | null>(null);
  const pendingDraftSnapshotRef = useRef<UploadDraftSnapshot | null>(null);
  const lastPersistedDraftSnapshotRef = useRef<string | null>(null);
  const liveSplitPercentRef = useRef(splitPercent);
  const mediaOverridesRef = useRef<Record<string, string>>(mediaOverrides);
  const mediaSelectionVersionByPathRef = useRef<Map<string, number>>(new Map());

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
  const uploadBlockingDiagnostics = useMemo(
    () => getUploadBlockingSchemaDiagnostics(diagnostics),
    [diagnostics],
  );
  const uploadBlockingMessage = useMemo(
    () => getUploadBlockingSchemaMessage(diagnostics),
    [diagnostics],
  );
  const hasUploadBlockingDiagnostics = uploadBlockingDiagnostics.length > 0;
  const uploadSuggestionDiagnostics = useMemo(
    () => getUploadSuggestionSchemaDiagnostics(diagnostics),
    [diagnostics],
  );
  const uploadSuggestionMessage = useMemo(
    () => getUploadSuggestionSchemaMessage(diagnostics),
    [diagnostics],
  );

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

  function clearPreviewDebounceTimer() {
    if (previewDebounceTimerRef.current === null) {
      return;
    }

    window.clearTimeout(previewDebounceTimerRef.current);
    previewDebounceTimerRef.current = null;
  }

  const clearDraftPersistTimer = useCallback(() => {
    if (draftPersistTimerRef.current === null) {
      return;
    }

    window.clearTimeout(draftPersistTimerRef.current);
    draftPersistTimerRef.current = null;
  }, []);

  const clearDraftPersistIdleCallback = useCallback(() => {
    if (typeof window === "undefined" || draftPersistIdleCallbackRef.current === null) {
      return;
    }

    const browserWindow = window as WindowWithIdleCallback;
    if (typeof browserWindow.cancelIdleCallback === "function") {
      browserWindow.cancelIdleCallback(draftPersistIdleCallbackRef.current);
    } else {
      window.clearTimeout(draftPersistIdleCallbackRef.current);
    }

    draftPersistIdleCallbackRef.current = null;
  }, []);

  const flushPendingUploadDraft = useCallback(() => {
    clearDraftPersistTimer();
    clearDraftPersistIdleCallback();

    let serializedSnapshot: string | null = null;
    try {
      serializedSnapshot = pendingDraftSnapshotRef.current
        ? JSON.stringify(pendingDraftSnapshotRef.current)
        : null;
    } catch {
      return;
    }

    if (serializedSnapshot === lastPersistedDraftSnapshotRef.current) {
      return;
    }

    persistUploadDraftSnapshot(serializedSnapshot);
    lastPersistedDraftSnapshotRef.current = serializedSnapshot;
  }, [clearDraftPersistIdleCallback, clearDraftPersistTimer]);

  const schedulePendingUploadDraftPersist = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    clearDraftPersistTimer();
    clearDraftPersistIdleCallback();

    draftPersistTimerRef.current = window.setTimeout(() => {
      draftPersistTimerRef.current = null;

      const runPersist = () => {
        draftPersistIdleCallbackRef.current = null;
        flushPendingUploadDraft();
      };

      const browserWindow = window as WindowWithIdleCallback;
      if (typeof browserWindow.requestIdleCallback === "function") {
        draftPersistIdleCallbackRef.current = browserWindow.requestIdleCallback(runPersist, {
          timeout: UPLOAD_DRAFT_PERSIST_IDLE_TIMEOUT_MS,
        });
        return;
      }

      draftPersistIdleCallbackRef.current = window.setTimeout(runPersist, 0);
    }, UPLOAD_DRAFT_PERSIST_DEBOUNCE_MS);
  }, [clearDraftPersistIdleCallback, clearDraftPersistTimer, flushPendingUploadDraft]);

  function revokeMediaOverrideUrls(overrides: Record<string, string>) {
    for (const value of Object.values(overrides)) {
      if (value.startsWith("blob:")) {
        URL.revokeObjectURL(value);
      }
    }
  }

  function resetPreviewState() {
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
    mediaSelectionVersionByPathRef.current.clear();
  }

  useEffect(() => {
    const mediaSelectionVersionByPath = mediaSelectionVersionByPathRef.current;

    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      inFlightControllerRef.current?.abort();
      inFlightControllerRef.current = null;

      flushPendingUploadDraft();
      clearPreviewDebounceTimer();
      previewRenderControllerRef.current?.abort();
      previewRenderControllerRef.current = null;

      revokeMediaOverrideUrls(mediaOverridesRef.current);
      mediaOverridesRef.current = {};
      mediaSelectionVersionByPath.clear();
    };
  }, [flushPendingUploadDraft]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setIsDraftHydrated(true);
      return;
    }

    try {
      const rawDraft = window.localStorage.getItem(UPLOAD_DRAFT_STORAGE_KEY);
      if (!rawDraft) {
        setIsDraftHydrated(true);
        return;
      }

      const parsedDraft = parseUploadDraftSnapshot(
        JSON.parse(rawDraft) as UploadDraftSnapshot | null,
      );

      if (!parsedDraft) {
        clearPersistedUploadDraft();
        setIsDraftHydrated(true);
        return;
      }

      lastPersistedDraftSnapshotRef.current = rawDraft;

      setTitleValue(parsedDraft.title);
      setCategoryValue(parsedDraft.category);

      if (parsedDraft.localLiquidSource.trim().length > 0) {
        const parsedResult = parseLiquidSchema(parsedDraft.localLiquidSource);
        const restoredState = parsedResult.schema
          ? (parsedDraft.editorState ?? buildInitialEditorState(parsedResult.schema))
          : null;
        const primaryDiagnostic = parsedResult.diagnostics.find((diagnostic) => diagnostic.level === "error")
          ?? parsedResult.diagnostics[0];
        const hasPendingBlockType = parsedDraft.pendingBlockType.trim().length > 0
          && (parsedResult.schema?.blocks ?? []).some((block) => block.type === parsedDraft.pendingBlockType);

        setLocalLiquidSource(parsedDraft.localLiquidSource);
        setLocalLiquidFileName(parsedDraft.localLiquidFileName);
        setSchema(parsedResult.schema);
        setDiagnostics(parsedResult.diagnostics);
        setEditorState(restoredState);
        setPendingBlockType(hasPendingBlockType ? parsedDraft.pendingBlockType : (parsedResult.schema?.blocks[0]?.type ?? ""));
        blockIdCounterRef.current = restoredState?.blocks.length ?? 0;
        setSplitPercent(clampSplitPercent(parsedDraft.splitPercent));
        setPreviewHtml("");
        setPreviewError(parsedResult.schema ? null : (primaryDiagnostic?.message ?? "Liquid schema parsing failed."));
        setDraftStatusMessage("Restored your last upload preview draft. Re-select the thumbnail file before uploading.");
      }
    } catch {
      clearPersistedUploadDraft();
    } finally {
      setIsDraftHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isDraftHydrated || typeof window === "undefined") {
      return;
    }

    const hasDraftContent = titleValue.trim().length > 0
      || categoryValue.trim().length > 0
      || localLiquidSource.trim().length > 0
      || localLiquidFileName !== null
      || editorState !== null;

    pendingDraftSnapshotRef.current = hasDraftContent
      ? {
        version: 1,
        title: titleValue,
        category: categoryValue,
        localLiquidSource,
        localLiquidFileName,
        editorState,
        pendingBlockType,
        splitPercent,
      }
      : null;

    schedulePendingUploadDraftPersist();
    return () => {
      clearDraftPersistTimer();
      clearDraftPersistIdleCallback();
    };
  }, [
    categoryValue,
    clearDraftPersistIdleCallback,
    clearDraftPersistTimer,
    editorState,
    isDraftHydrated,
    localLiquidFileName,
    localLiquidSource,
    pendingBlockType,
    schedulePendingUploadDraftPersist,
    splitPercent,
    titleValue,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePageHide = () => {
      flushPendingUploadDraft();
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [flushPendingUploadDraft]);

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
      const clearLocalMediaPreviewError = () => {
        setPreviewError((current) =>
          current?.startsWith(LOCAL_MEDIA_PREVIEW_ERROR_PREFIX) ? null : current,
        );
      };

      const versionMap = mediaSelectionVersionByPathRef.current;
      const nextVersion = (versionMap.get(pathKey) ?? 0) + 1;
      versionMap.set(pathKey, nextVersion);

      if (!file) {
        clearLocalMediaPreviewError();
        updateMediaOverride(pathKey, null);
        return;
      }

      if (file.size > LOCAL_MEDIA_PREVIEW_MAX_BYTES) {
        const selectedSizeMb = Math.ceil(file.size / 1024 / 1024);
        const maxSizeMb = Math.floor(LOCAL_MEDIA_PREVIEW_MAX_BYTES / 1024 / 1024);
        setPreviewError(
          `Local preview file is ${selectedSizeMb}MB. Choose a file under ${maxSizeMb}MB.`,
        );
        updateMediaOverride(pathKey, null);
        return;
      }

      void readLocalMediaFileAsDataUrl(file)
        .then((dataUrl) => {
          if (versionMap.get(pathKey) !== nextVersion) {
            return;
          }

          clearLocalMediaPreviewError();
          updateMediaOverride(pathKey, dataUrl);
        })
        .catch((error) => {
          if (versionMap.get(pathKey) !== nextVersion) {
            return;
          }

          setPreviewError(
            error instanceof Error
              ? error.message
              : "Local preview file could not be loaded.",
          );
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
    setDraftStatusMessage(null);

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current || isSubmitting || isPreparingThumbnail || inFlightControllerRef.current) {
      return;
    }
    submitLockRef.current = true;

    try {
      setErrorMessage(null);
      setRequestId(null);
      setUploadedComponent(null);
      setThumbnailStatusMessage(null);

      if (hasUploadBlockingDiagnostics) {
        setErrorMessage(uploadBlockingMessage ?? "Fix the Liquid file issues before uploading.");
        return;
      }

      const form = event.currentTarget;
      const formData = new FormData(form);
      const selectedThumbnailFile = thumbnailInputRef.current?.files?.[0] ?? null;
      let thumbnailFileForUpload = selectedThumbnailFile;

      if (selectedThumbnailFile) {
        setIsPreparingThumbnail(true);
        try {
          const preparedThumbnail = await prepareThumbnailUploadFileOnDemand(selectedThumbnailFile);
          thumbnailFileForUpload = preparedThumbnail.file;
          setThumbnailStatusMessage(preparedThumbnail.message);
        } catch (error) {
          if (selectedThumbnailFile.size > validationLimits.THUMBNAIL_MAX_BYTES) {
            setErrorMessage(
              error instanceof Error
                ? `${error.message} Choose a smaller video thumbnail or use a browser with MediaRecorder support.`
                : "Video thumbnail compression failed. Choose a smaller video thumbnail.",
            );
            return;
          }

          setThumbnailStatusMessage(
            "Video compression failed, so the original thumbnail will be uploaded.",
          );
        } finally {
          if (isMountedRef.current) {
            setIsPreparingThumbnail(false);
          }
        }
      }

      if (!thumbnailFileForUpload) {
        formData.delete("thumbnail");
      } else {
        if (thumbnailFileForUpload.size > validationLimits.THUMBNAIL_MAX_BYTES) {
          setErrorMessage("Thumbnail still exceeds the 25MB upload limit after compression.");
          return;
        }

        formData.set("thumbnail", thumbnailFileForUpload);
      }

      const selectedLiquidFile = liquidInputRef.current?.files?.[0] ?? null;
      if (localLiquidSource.trim().length > 0) {
        const sourceForUpload = schema && editorState
          ? patchLiquidSchemaDefaults(localLiquidSource, schema, editorState)
          : localLiquidSource;

        const editedLiquidFile = new File([sourceForUpload], selectedLiquidFile?.name ?? localLiquidFileName ?? "component.liquid", {
          type: selectedLiquidFile?.type || "text/plain",
          lastModified: Date.now(),
        });
        formData.set("liquidFile", editedLiquidFile);
      }

      const controller = new AbortController();
      inFlightControllerRef.current = controller;
      setIsSubmitting(true);

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
        setTitleValue("");
        setCategoryValue("");
        setDraftStatusMessage(null);
        setThumbnailStatusMessage(null);
        resetPreviewState();
        pendingDraftSnapshotRef.current = null;
        clearDraftPersistTimer();
        clearDraftPersistIdleCallback();
        lastPersistedDraftSnapshotRef.current = null;
        clearPersistedUploadDraft();
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
    } finally {
      submitLockRef.current = false;
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
            value={titleValue}
            onChange={(event) => setTitleValue(event.currentTarget.value)}
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
            value={categoryValue}
            onChange={(event) => setCategoryValue(event.currentTarget.value)}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 transition-colors focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
          />
        </div>
      </div>

      <div>
        <label htmlFor="thumbnail" className="block text-sm font-medium text-zinc-800">
          Thumbnail (image or video, optional)
        </label>
        <input
          ref={thumbnailInputRef}
          id="thumbnail"
          name="thumbnail"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm"
          onChange={() => setThumbnailStatusMessage(null)}
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
        />
        <p className="mt-1 text-xs text-zinc-500">
          You can skip this for now and add or replace the thumbnail later from Manage Components.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Video thumbnails are auto-compressed to a small gallery-card format that preserves the full frame.
        </p>
        {thumbnailStatusMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800"
          >
            {thumbnailStatusMessage}
          </div>
        ) : null}
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
          required={!localLiquidSource}
          accept=".liquid,text/plain,text/x-liquid,application/octet-stream"
          onChange={handleLiquidFileChange}
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
        />
        {localLiquidSource ? (
          <p className="mt-1 text-xs text-zinc-500">
            Current draft source is loaded. Re-selecting the file is optional unless you want to replace it.
          </p>
        ) : null}
        {uploadBlockingMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            <p className="font-medium">Fix Liquid file issues before uploading.</p>
            <p className="mt-1">{uploadBlockingMessage}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {uploadBlockingDiagnostics.slice(0, 3).map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${diagnostic.path ?? "unknown"}-${index}`}>
                  {diagnostic.message}
                  {diagnostic.path ? ` (${diagnostic.path})` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!hasUploadBlockingDiagnostics && uploadSuggestionMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            <p className="font-medium">Review Liquid file suggestions.</p>
            <p className="mt-1">{uploadSuggestionMessage}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {uploadSuggestionDiagnostics.slice(0, 3).map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${diagnostic.path ?? "unknown"}-${index}`}>
                  {diagnostic.message}
                  {diagnostic.path ? ` (${diagnostic.path})` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
            Split-View Liquid Editor
          </h2>
          <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600">
            Optional
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Reuses the same schema settings + block controls as sandbox. Configure the component visually here so the
          saved Liquid file includes the right defaults and block count.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Upload draft settings are saved in this browser. Thumbnail and local preview files still need re-selection
          after a refresh.
        </p>

        {localLiquidFileName ? (
          <p className="mt-3 text-xs text-zinc-500">
            Loaded file: <span className="font-medium">{localLiquidFileName}</span>
          </p>
        ) : null}

        {draftStatusMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800"
          >
            {draftStatusMessage}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-600">
            {isRenderingPreview ? "Preview rendering…" : "Preview ready"}
          </span>
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
          <div className="mt-3 h-[62rem] min-h-[36rem]">
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
              previewViewportAspectRatio="4 / 3"
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
          {uploadedComponent.thumbnail_path ? null : (
            <p className="mt-1 text-xs">
              No thumbnail attached yet. You can add one below in Manage Components.
            </p>
          )}
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
        disabled={isSubmitting || isPreparingThumbnail || hasUploadBlockingDiagnostics}
        className="touch-manipulation rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {hasUploadBlockingDiagnostics
          ? "Fix Liquid File Issues"
          : (isPreparingThumbnail ? "Compressing Thumbnail…" : isSubmitting ? "Uploading…" : "Upload Component")}
      </button>
    </form>
  );
}
