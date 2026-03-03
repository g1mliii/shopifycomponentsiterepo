"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

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

export function UploadForm({ onUploaded }: UploadFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [uploadedComponent, setUploadedComponent] = useState<UploadedComponent | null>(null);
  const isMountedRef = useRef(true);
  const inFlightControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      inFlightControllerRef.current?.abort();
      inFlightControllerRef.current = null;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || inFlightControllerRef.current) {
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
    try {
      const response = await fetch("/api/admin/components", {
        method: "POST",
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
          id="liquidFile"
          name="liquidFile"
          type="file"
          required
          accept=".liquid,text/plain,text/x-liquid,application/octet-stream"
          className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
        />
      </div>

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
        disabled={isSubmitting}
        className="touch-manipulation rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Uploading…" : "Upload Component"}
      </button>
    </form>
  );
}
