"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatUtcTimestamp } from "@/lib/datetime/format-utc-timestamp";

import { UploadForm } from "./UploadForm";

type StoredComponent = {
  id: string;
  title: string;
  category: string;
  thumbnail_path: string;
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

export function ComponentsManager({ initialComponents, listLimit }: ComponentsManagerProps) {
  const [components, setComponents] = useState<StoredComponent[]>(initialComponents);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const refreshControllerRef = useRef<AbortController | null>(null);
  const deleteControllerRef = useRef<AbortController | null>(null);
  const componentsWithFormattedCreatedAt = useMemo(
    () =>
      components.map((component) => ({
        ...component,
        createdAtLabel: formatUtcTimestamp(component.created_at),
      })),
    [components],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
      deleteControllerRef.current?.abort();
      deleteControllerRef.current = null;
    };
  }, []);

  function handleUploaded(component: StoredComponent) {
    setComponents((current) => {
      const next = [component, ...current.filter((item) => item.id !== component.id)];
      return next.slice(0, listLimit);
    });
    setErrorMessage(null);
  }

  async function refreshComponents() {
    if (isRefreshing || refreshControllerRef.current || isDeletingId || deleteControllerRef.current) {
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

  async function deleteComponent(component: StoredComponent) {
    if (isDeletingId || deleteControllerRef.current || isRefreshing || refreshControllerRef.current) {
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
  }

  return (
    <>
      <UploadForm onUploaded={handleUploaded} />

      <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">Manage Components</h2>
          <button
            type="button"
            onClick={() => void refreshComponents()}
            disabled={isRefreshing || Boolean(isDeletingId)}
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
              <li key={component.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
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
                      thumbnail_path: <code>{component.thumbnail_path}</code>
                    </p>
                    <p className="mt-1 break-all text-xs text-zinc-500">
                      file_path: <code>{component.file_path}</code>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteComponent(component)}
                    disabled={Boolean(isDeletingId) || isRefreshing}
                    className="touch-manipulation rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeletingId === component.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
