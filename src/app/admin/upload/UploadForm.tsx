"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { renderLiquidPreview } from "@/lib/liquid/render";
import { parseLiquidSchema } from "@/lib/liquid/schema-parse";
import { buildInitialEditorState } from "@/lib/liquid/schema-patch";

const MAX_RECORDING_FRAME_RATE = 30;
const THUMBNAIL_MAX_BYTES = 25 * 1024 * 1024;
const RECORDING_MAX_BYTES = 24 * 1024 * 1024;
const RECORDING_MAX_DURATION_MS = 30_000;
const PREVIEW_PLACEHOLDER_TEXT = "Select a .liquid file above, then render a local preview.";

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

function buildLocalPreviewDocument(html: string): string {
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
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [isRecordingPreview, setIsRecordingPreview] = useState(false);
  const [recordingMessage, setRecordingMessage] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const localFileLoadTokenRef = useRef(0);
  const inFlightControllerRef = useRef<AbortController | null>(null);
  const previewRenderControllerRef = useRef<AbortController | null>(null);
  const liquidInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingBytesRef = useRef(0);
  const recordingStopReasonRef = useRef<"manual" | "max_size" | "max_duration" | null>(null);
  const recordingStartInFlightRef = useRef(false);
  const recordingAutoStopTimerRef = useRef<number | null>(null);

  const previewDocument = useMemo(() => buildLocalPreviewDocument(previewHtml), [previewHtml]);

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

  function resetPreviewAndRecordingState() {
    localFileLoadTokenRef.current += 1;
    setLocalLiquidSource("");
    setLocalLiquidFileName(null);
    setPreviewHtml("");
    setPreviewError(null);
    setIsRenderingPreview(false);
    setIsRecordingPreview(false);
    setRecordingMessage(null);
    setRecordingError(null);

    previewRenderControllerRef.current?.abort();
    previewRenderControllerRef.current = null;

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
    };
  }, []);

  async function renderLocalPreview(nextSource: string) {
    const trimmedSource = nextSource.trim();
    if (!trimmedSource) {
      setPreviewHtml("");
      setPreviewError("Liquid source is empty.");
      return;
    }

    const parsedResult = parseLiquidSchema(nextSource);
    if (!parsedResult.schema) {
      const primaryDiagnostic = parsedResult.diagnostics.find((diagnostic) => diagnostic.level === "error")
        ?? parsedResult.diagnostics[0];
      setPreviewHtml("");
      setPreviewError(primaryDiagnostic?.message ?? "Liquid schema parsing failed.");
      return;
    }

    const controller = new AbortController();
    previewRenderControllerRef.current?.abort();
    previewRenderControllerRef.current = controller;

    setIsRenderingPreview(true);
    setPreviewError(null);

    try {
      const initialState = buildInitialEditorState(parsedResult.schema);
      const result = await renderLiquidPreview(nextSource, initialState, controller.signal);

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
  }

  async function loadLiquidFileForPreview(file: File | null) {
    const token = localFileLoadTokenRef.current + 1;
    localFileLoadTokenRef.current = token;

    if (!file) {
      setLocalLiquidSource("");
      setLocalLiquidFileName(null);
      setPreviewHtml("");
      setPreviewError(null);
      return;
    }

    try {
      const source = await file.text();
      if (!isMountedRef.current || localFileLoadTokenRef.current !== token) {
        return;
      }

      setLocalLiquidSource(source);
      setLocalLiquidFileName(file.name);
      setPreviewHtml("");
      setPreviewError(null);
      setRecordingMessage(null);
      setRecordingError(null);
      await renderLocalPreview(source);
    } catch {
      if (!isMountedRef.current || localFileLoadTokenRef.current !== token) {
        return;
      }

      setLocalLiquidSource("");
      setLocalLiquidFileName(file.name);
      setPreviewHtml("");
      setPreviewError("Failed to read selected Liquid file.");
    }
  }

  function handleLiquidFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    void loadLiquidFileForPreview(file);
  }

  async function handleStartRecordingPreview() {
    if (isRecordingPreview || recordingStartInFlightRef.current) {
      return;
    }

    recordingStartInFlightRef.current = true;

    if (!previewHtml.trim()) {
      setRecordingError("Render a local preview before starting a recording.");
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
      const editedLiquidFile = new File([localLiquidSource], selectedLiquidFile.name, {
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
            Local Liquid Preview + Recording
          </h2>
          <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600">
            Optional
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Reuses the sandbox Liquid renderer for local preview. Edit source, re-render, then record a short clip to
          auto-fill the thumbnail input.
        </p>

        <div className="mt-3">
          <label htmlFor="localLiquidSource" className="block text-xs font-medium uppercase tracking-wide text-zinc-700">
            Local Source Editor
          </label>
          <textarea
            id="localLiquidSource"
            value={localLiquidSource}
            onChange={(event) => setLocalLiquidSource(event.currentTarget.value)}
            placeholder={
              localLiquidFileName
                ? "Adjust Liquid source before rendering preview."
                : "Choose a .liquid file above to load editable source."
            }
            className="mt-1 block h-40 w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-900 focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
            spellCheck={false}
          />
          {localLiquidFileName ? (
            <p className="mt-1 text-xs text-zinc-500">
              Loaded file: <span className="font-medium">{localLiquidFileName}</span>
            </p>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void renderLocalPreview(localLiquidSource)}
            disabled={isRenderingPreview || localLiquidSource.trim().length === 0 || isRecordingPreview}
            className="touch-manipulation rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-800 transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRenderingPreview ? "Rendering…" : "Render Preview"}
          </button>

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
              disabled={isRenderingPreview || previewHtml.trim().length === 0}
              className="touch-manipulation rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-transform duration-150 motion-reduce:transition-none motion-safe:hover:will-change-transform motion-safe:hover:transform-gpu motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start Recording
            </button>
          )}
        </div>

        {previewError ? (
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

        <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="aspect-[4/3] w-full">
            {previewHtml.trim().length > 0 ? (
              <iframe
                title="Local Liquid preview"
                srcDoc={previewDocument}
                sandbox=""
                className="h-full w-full border-0"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-zinc-500">
                {PREVIEW_PLACEHOLDER_TEXT}
              </div>
            )}
          </div>
        </div>
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
