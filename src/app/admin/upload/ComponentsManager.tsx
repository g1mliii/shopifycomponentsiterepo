"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatUtcTimestamp } from "@/lib/datetime/format-utc-timestamp";
import { validationLimits } from "@/lib/validation/upload-component";

import { UploadForm } from "./UploadForm";

type StoredComponent = {
  id: string;
  title: string;
  category: string;
  thumbnail_path: string | null;
  file_path: string;
  created_at: string;
  updated_at: string;
};

type ComponentsListResponse = {
  components?: StoredComponent[];
  requestId?: string;
};

type DeleteComponentResponse = {
  deletedComponentId?: string;
  requestId?: string;
};

type UpdateThumbnailResponse = {
  component?: StoredComponent;
  requestId?: string;
};

type ApiErrorResponse = {
  error?: {
    message?: string;
    requestId?: string;
  };
};

type ComponentsManagerProps = {
  initialComponents: StoredComponent[];
  listLimit: number;
};

type DisplayComponent = StoredComponent & {
  createdAtLabel: string;
};

type ComponentRowProps = {
  component: DisplayComponent;
  selectedThumbnailName: string | null;
  thumbnailInputVersion: number;
  thumbnailStatusMessage: string | null;
  isBusy: boolean;
  isDeleting: boolean;
  isPreparingThumbnail: boolean;
  isUpdatingThumbnail: boolean;
  onDelete: (component: StoredComponent) => Promise<void>;
  onSaveThumbnail: (component: StoredComponent) => Promise<void>;
  onThumbnailFileChange: (componentId: string, file: File | null) => void;
};

async function prepareThumbnailUploadFileOnDemand(file: File) {
  const { prepareThumbnailUploadFile } = await import("@/lib/media/thumbnail-video-compression");
  return prepareThumbnailUploadFile(file);
}

function pruneRecordByVisibleIds<T>(current: Record<string, T>, visibleIds: Set<string>): Record<string, T> {
  let didPrune = false;
  const next: Record<string, T> = {};

  for (const [componentId, value] of Object.entries(current)) {
    if (!visibleIds.has(componentId)) {
      didPrune = true;
      continue;
    }

    next[componentId] = value;
  }

  return didPrune ? next : current;
}

const ComponentRow = memo(function ComponentRow({
  component,
  selectedThumbnailName,
  thumbnailInputVersion,
  thumbnailStatusMessage,
  isBusy,
  isDeleting,
  isPreparingThumbnail,
  isUpdatingThumbnail,
  onDelete,
  onSaveThumbnail,
  onThumbnailFileChange,
}: ComponentRowProps) {
  return (
    <li className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900">{component.title}</p>
          <p className="mt-1 text-xs text-zinc-600">
            Category: <span className="font-medium">{component.category}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Created: <span className="font-medium">{component.createdAtLabel}</span>
          </p>
          <p className="mt-2 break-all text-xs text-zinc-500">
            thumbnail_path: <code>{component.thumbnail_path ?? "not added yet"}</code>
          </p>
          <p className="mt-1 break-all text-xs text-zinc-500">
            file_path: <code>{component.file_path}</code>
          </p>
          <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3">
            <p className="text-xs font-medium text-zinc-800">
              {component.thumbnail_path ? "Thumbnail attached" : "Thumbnail pending"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Video thumbnails auto-compress to a small gallery-card format that preserves the full frame.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                key={thumbnailInputVersion}
                id={`thumbnail-update-${component.id}`}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm"
                onChange={(event) => {
                  onThumbnailFileChange(component.id, event.currentTarget.files?.[0] ?? null);
                }}
                disabled={isBusy}
                className="block min-w-[16rem] max-w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-800 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-xs file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void onSaveThumbnail(component)}
                disabled={!selectedThumbnailName || isBusy}
                className="touch-manipulation rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPreparingThumbnail
                  ? "Compressing Thumbnail…"
                  : isUpdatingThumbnail
                  ? "Saving Thumbnail…"
                  : component.thumbnail_path
                    ? "Replace Thumbnail"
                    : "Add Thumbnail"}
              </button>
            </div>
            {selectedThumbnailName ? (
              <p className="mt-2 break-all text-xs text-zinc-500">
                Selected file: <span className="font-medium">{selectedThumbnailName}</span>
              </p>
            ) : null}
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
        </div>
        <button
          type="button"
          onClick={() => void onDelete(component)}
          disabled={isBusy}
          className="touch-manipulation rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isDeleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </li>
  );
});

ComponentRow.displayName = "ComponentRow";

export function ComponentsManager({ initialComponents, listLimit }: ComponentsManagerProps) {
  const [components, setComponents] = useState<StoredComponent[]>(initialComponents);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isUpdatingThumbnailId, setIsUpdatingThumbnailId] = useState<string | null>(null);
  const [isPreparingThumbnailId, setIsPreparingThumbnailId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [thumbnailStatusMessage, setThumbnailStatusMessage] = useState<string | null>(null);
  const [thumbnailStatusComponentId, setThumbnailStatusComponentId] = useState<string | null>(null);
  const [selectedThumbnailNamesById, setSelectedThumbnailNamesById] = useState<Record<string, string>>({});
  const [thumbnailInputVersionById, setThumbnailInputVersionById] = useState<Record<string, number>>({});
  const isMountedRef = useRef(true);
  const updateThumbnailLockRef = useRef(false);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const deleteControllerRef = useRef<AbortController | null>(null);
  const updateThumbnailControllerRef = useRef<AbortController | null>(null);
  const selectedThumbnailFilesRef = useRef<Map<string, File>>(new Map());
  const componentsWithFormattedCreatedAt = useMemo(
    () =>
      components.map((component) => ({
        ...component,
        createdAtLabel: formatUtcTimestamp(component.created_at),
      })),
    [components],
  );

  useEffect(() => {
    const selectedThumbnailFiles = selectedThumbnailFilesRef.current;

    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
      deleteControllerRef.current?.abort();
      deleteControllerRef.current = null;
      updateThumbnailControllerRef.current?.abort();
      updateThumbnailControllerRef.current = null;
      selectedThumbnailFiles.clear();
    };
  }, []);

  useEffect(() => {
    const visibleIds = new Set(components.map((component) => component.id));

    selectedThumbnailFilesRef.current.forEach((_file, componentId) => {
      if (!visibleIds.has(componentId)) {
        selectedThumbnailFilesRef.current.delete(componentId);
      }
    });

    setSelectedThumbnailNamesById((current) => pruneRecordByVisibleIds(current, visibleIds));
    setThumbnailInputVersionById((current) => pruneRecordByVisibleIds(current, visibleIds));

    if (thumbnailStatusComponentId && !visibleIds.has(thumbnailStatusComponentId)) {
      setThumbnailStatusComponentId(null);
      setThumbnailStatusMessage(null);
    }
  }, [components, thumbnailStatusComponentId]);

  const handleUploaded = useCallback((component: StoredComponent) => {
    setComponents((current) => {
      const next = [component, ...current.filter((item) => item.id !== component.id)];
      return next.slice(0, listLimit);
    });
    setErrorMessage(null);
  }, [listLimit]);

  const handleThumbnailFileChange = useCallback((componentId: string, file: File | null) => {
    setThumbnailStatusComponentId(null);
    setThumbnailStatusMessage(null);
    setSelectedThumbnailNamesById((current) => {
      if (!file) {
        selectedThumbnailFilesRef.current.delete(componentId);
        if (!(componentId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[componentId];
        return next;
      }

      selectedThumbnailFilesRef.current.set(componentId, file);
      if (current[componentId] === file.name) {
        return current;
      }

      return {
        ...current,
        [componentId]: file.name,
      };
    });
  }, []);

  async function refreshComponents() {
    if (
      isRefreshing
      || refreshControllerRef.current
      || isDeletingId
      || deleteControllerRef.current
      || isPreparingThumbnailId
      || isUpdatingThumbnailId
      || updateThumbnailControllerRef.current
    ) {
      return;
    }

    const controller = new AbortController();
    refreshControllerRef.current = controller;

    setIsRefreshing(true);
    setErrorMessage(null);
    setRequestId(null);
    try {
      const response = await fetch(`/api/admin/components?limit=${encodeURIComponent(String(listLimit))}`, {
        method: "GET",
        signal: controller.signal,
      });
      const body = (await response
        .json()
        .catch(() => null)) as ComponentsListResponse | ApiErrorResponse | null;

      if (!isMountedRef.current) {
        return;
      }

      if (!response.ok) {
        const errorBody = body as ApiErrorResponse | null;
        setErrorMessage(errorBody?.error?.message ?? "Failed to refresh components.");
        setRequestId(errorBody?.error?.requestId ?? null);
        return;
      }

      if (!body || !("components" in body) || !Array.isArray(body.components)) {
        setErrorMessage("Refresh completed but response was malformed.");
        return;
      }

      setComponents(body.components);
      setRequestId(body.requestId ?? null);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setErrorMessage("Failed to refresh components.");
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
      }

      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }

  const deleteComponent = useCallback(async (component: StoredComponent) => {
    if (
      isDeletingId
      || deleteControllerRef.current
      || isRefreshing
      || refreshControllerRef.current
      || isUpdatingThumbnailId
      || isPreparingThumbnailId
      || updateThumbnailControllerRef.current
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${component.title}"? This permanently removes the component row and files.`,
    );
    if (!confirmed) {
      return;
    }

    const controller = new AbortController();
    deleteControllerRef.current = controller;

    setIsDeletingId(component.id);
    setErrorMessage(null);
    setRequestId(null);
    try {
      const response = await fetch(`/api/admin/components?id=${encodeURIComponent(component.id)}`, {
        method: "DELETE",
        headers: {
          "x-admin-csrf": "1",
        },
        signal: controller.signal,
      });
      const body = (await response
        .json()
        .catch(() => null)) as DeleteComponentResponse | ApiErrorResponse | null;

      if (!isMountedRef.current) {
        return;
      }

      if (!response.ok) {
        const errorBody = body as ApiErrorResponse | null;
        setErrorMessage(errorBody?.error?.message ?? "Delete failed.");
        setRequestId(errorBody?.error?.requestId ?? null);
        return;
      }

      setComponents((current) => current.filter((item) => item.id !== component.id));
      setThumbnailStatusComponentId(null);
      setThumbnailStatusMessage(null);
      selectedThumbnailFilesRef.current.delete(component.id);
      setSelectedThumbnailNamesById((current) => {
        if (!(component.id in current)) {
          return current;
        }

        const next = { ...current };
        delete next[component.id];
        return next;
      });
      const successBody = body as DeleteComponentResponse | null;
      setRequestId(successBody?.requestId ?? null);
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setErrorMessage("Delete request failed.");
    } finally {
      if (deleteControllerRef.current === controller) {
        deleteControllerRef.current = null;
      }

      if (isMountedRef.current) {
        setIsDeletingId(null);
      }
    }
  }, [isDeletingId, isPreparingThumbnailId, isRefreshing, isUpdatingThumbnailId]);

  const clearSelectedThumbnail = useCallback((componentId: string) => {
    selectedThumbnailFilesRef.current.delete(componentId);
    setSelectedThumbnailNamesById((current) => {
      if (!(componentId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[componentId];
      return next;
    });

    setThumbnailInputVersionById((current) => ({
      ...current,
      [componentId]: (current[componentId] ?? 0) + 1,
    }));
  }, []);

  const updateComponentThumbnail = useCallback(async (component: StoredComponent) => {
    if (
      updateThumbnailLockRef.current
      || Boolean(isPreparingThumbnailId)
      || Boolean(isUpdatingThumbnailId)
      || Boolean(updateThumbnailControllerRef.current)
      || isRefreshing
      || Boolean(refreshControllerRef.current)
      || Boolean(isDeletingId)
      || Boolean(deleteControllerRef.current)
    ) {
      return;
    }
    updateThumbnailLockRef.current = true;

    try {
      const thumbnailFile = selectedThumbnailFilesRef.current.get(component.id) ?? null;
      if (!thumbnailFile) {
        setErrorMessage("Select a thumbnail file before saving.");
        setRequestId(null);
        return;
      }

      let thumbnailFileForUpload = thumbnailFile;
      setErrorMessage(null);
      setRequestId(null);
      setThumbnailStatusComponentId(component.id);
      setThumbnailStatusMessage(null);
      setIsPreparingThumbnailId(component.id);
      try {
        const preparedThumbnail = await prepareThumbnailUploadFileOnDemand(thumbnailFile);
        thumbnailFileForUpload = preparedThumbnail.file;
        setThumbnailStatusMessage(preparedThumbnail.message);
      } catch (error) {
        if (thumbnailFile.size > validationLimits.THUMBNAIL_MAX_BYTES) {
          setErrorMessage(
            error instanceof Error
              ? `${error.message} Choose a smaller video thumbnail or use a browser with MediaRecorder support.`
              : "Video thumbnail compression failed. Choose a smaller video thumbnail.",
          );
          setRequestId(null);
          return;
        }

        setThumbnailStatusMessage(
          "Video compression failed, so the original thumbnail will be uploaded.",
        );
      } finally {
        if (isMountedRef.current) {
          setIsPreparingThumbnailId(null);
        }
      }

      const controller = new AbortController();
      updateThumbnailControllerRef.current = controller;

      setIsUpdatingThumbnailId(component.id);

      try {
        const formData = new FormData();
        formData.set("id", component.id);
        if (thumbnailFileForUpload.size > validationLimits.THUMBNAIL_MAX_BYTES) {
          setErrorMessage("Thumbnail still exceeds the 25MB upload limit after compression.");
          return;
        }

        formData.set("thumbnail", thumbnailFileForUpload);

        const response = await fetch("/api/admin/components", {
          method: "PATCH",
          headers: {
            "x-admin-csrf": "1",
          },
          body: formData,
          signal: controller.signal,
        });
        const body = (await response
          .json()
          .catch(() => null)) as UpdateThumbnailResponse | ApiErrorResponse | null;

        if (!isMountedRef.current) {
          return;
        }

        if (!response.ok) {
          const errorBody = body as ApiErrorResponse | null;
          setErrorMessage(errorBody?.error?.message ?? "Thumbnail update failed.");
          setRequestId(errorBody?.error?.requestId ?? null);
          return;
        }

        if (!body || !("component" in body) || !body.component) {
          setErrorMessage("Thumbnail update completed but response was malformed.");
          return;
        }

        const updatedComponent = body.component;
        setComponents((current) =>
          current.map((item) => (item.id === updatedComponent.id ? updatedComponent : item)),
        );
        clearSelectedThumbnail(component.id);
        setRequestId(body.requestId ?? null);
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setErrorMessage("Thumbnail update request failed.");
      } finally {
        if (updateThumbnailControllerRef.current === controller) {
          updateThumbnailControllerRef.current = null;
        }

        if (isMountedRef.current) {
          setIsUpdatingThumbnailId(null);
        }
      }
    } finally {
      updateThumbnailLockRef.current = false;
    }
  }, [clearSelectedThumbnail, isDeletingId, isPreparingThumbnailId, isRefreshing, isUpdatingThumbnailId]);

  const isAnyActionInProgress = isRefreshing
    || Boolean(isDeletingId)
    || Boolean(isUpdatingThumbnailId)
    || Boolean(isPreparingThumbnailId);

  return (
    <>
      <UploadForm onUploaded={handleUploaded} />

      <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">Manage Components</h2>
          <button
            type="button"
            onClick={() => void refreshComponents()}
            disabled={isAnyActionInProgress}
            className="touch-manipulation rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRefreshing ? "Refreshing…" : "Refresh List"}
          </button>
        </div>

        <p className="mt-2 text-sm text-zinc-600">
          {components.length} component{components.length === 1 ? "" : "s"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Showing the latest {listLimit} component{listLimit === 1 ? "" : "s"}.
        </p>

        {errorMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            <p>{errorMessage}</p>
            {requestId ? (
              <p className="mt-1 text-xs text-red-600">
                Request ID: <code>{requestId}</code>
              </p>
            ) : null}
          </div>
        ) : null}

        {components.length === 0 ? (
          <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
            No components uploaded yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {componentsWithFormattedCreatedAt.map((component) => (
              <ComponentRow
                key={component.id}
                component={component}
                selectedThumbnailName={selectedThumbnailNamesById[component.id] ?? null}
                thumbnailInputVersion={thumbnailInputVersionById[component.id] ?? 0}
                thumbnailStatusMessage={thumbnailStatusComponentId === component.id ? thumbnailStatusMessage : null}
                isBusy={isAnyActionInProgress}
                isDeleting={isDeletingId === component.id}
                isPreparingThumbnail={isPreparingThumbnailId === component.id}
                isUpdatingThumbnail={isUpdatingThumbnailId === component.id}
                onDelete={deleteComponent}
                onSaveThumbnail={updateComponentThumbnail}
                onThumbnailFileChange={handleThumbnailFileChange}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
