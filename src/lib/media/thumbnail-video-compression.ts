"use client";

const VIDEO_FILE_EXTENSIONS = new Set([".mp4", ".webm"]);
const OUTPUT_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "video/webm": ".webm",
  "video/mp4": ".mp4",
};
const COMPRESSION_MIME_TYPE_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
] as const;

export const galleryThumbnailVideoCompressionPreset = {
  targetWidth: 480,
  targetHeight: 360,
  frameRate: 12,
  videoBitsPerSecond: 450_000,
  minimumInputBytes: 1 * 1024 * 1024,
  maximumDurationMs: 8_000,
} as const;

export type PreparedThumbnailUploadResult = {
  file: File;
  didCompress: boolean;
  message: string | null;
  originalSize: number;
  finalSize: number;
};

type LoadedVideoMetadata = {
  width: number;
  height: number;
  durationSeconds: number;
};

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0) {
    return "";
  }

  return fileName.slice(lastDot).toLowerCase();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function isVideoThumbnailFile(file: Pick<File, "name" | "type">): boolean {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith("video/")) {
    return true;
  }

  return VIDEO_FILE_EXTENSIONS.has(getFileExtension(file.name));
}

export function shouldCompressThumbnailVideo(input: {
  sourceWidth: number;
  sourceHeight: number;
  fileSize: number;
}): boolean {
  return (
    input.fileSize > galleryThumbnailVideoCompressionPreset.minimumInputBytes
    || input.sourceWidth > galleryThumbnailVideoCompressionPreset.targetWidth
    || input.sourceHeight > galleryThumbnailVideoCompressionPreset.targetHeight
  );
}

export function getVideoContainPlacementRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const safeTargetWidth = Math.max(1, targetWidth);
  const safeTargetHeight = Math.max(1, targetHeight);
  const scale = Math.min(safeTargetWidth / safeWidth, safeTargetHeight / safeHeight);
  const scaledWidth = safeWidth * scale;
  const scaledHeight = safeHeight * scale;

  return {
    x: (safeTargetWidth - scaledWidth) / 2,
    y: (safeTargetHeight - scaledHeight) / 2,
    width: scaledWidth,
    height: scaledHeight,
  };
}

export function getThumbnailCompressionPlaybackLimitMs(durationSeconds: number): number {
  const sourceDurationMs = Number.isFinite(durationSeconds)
    ? Math.max(0, Math.ceil(durationSeconds * 1000))
    : 0;

  return Math.max(
    1_000,
    Math.min(
      galleryThumbnailVideoCompressionPreset.maximumDurationMs,
      sourceDurationMs + 250,
    ),
  );
}

export function buildCompressedThumbnailFileName(
  originalFileName: string,
  mimeType: string,
): string {
  const normalizedMimeType = normalizeVideoMimeType(mimeType);
  const extension = OUTPUT_EXTENSION_BY_MIME_TYPE[normalizedMimeType] ?? ".webm";
  const originalExtension = getFileExtension(originalFileName);
  const baseName = originalExtension.length > 0
    ? originalFileName.slice(0, -originalExtension.length)
    : originalFileName;

  return `${baseName}-card${extension}`;
}

export function normalizeVideoMimeType(mimeType: string): "video/webm" | "video/mp4" {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("video/mp4")) {
    return "video/mp4";
  }

  return "video/webm";
}

function pickMediaRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return null;
  }

  for (const candidate of COMPRESSION_MIME_TYPE_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return null;
}

function waitForVideoLoadedMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Video metadata could not be read."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

async function loadVideoMetadata(file: File): Promise<LoadedVideoMetadata> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Video compression requires a browser environment.");
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await waitForVideoLoadedMetadata(video);

    return {
      width: Math.max(1, video.videoWidth),
      height: Math.max(1, video.videoHeight),
      durationSeconds: Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    video.load();
  }
}

async function compressVideoThumbnail(
  file: File,
  metadata: LoadedVideoMetadata,
): Promise<{ blob: Blob; mimeType: string }> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Video compression requires a browser environment.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = galleryThumbnailVideoCompressionPreset.targetWidth;
  canvas.height = galleryThumbnailVideoCompressionPreset.targetHeight;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Canvas rendering is unavailable for video compression.");
  }

  if (typeof canvas.captureStream !== "function") {
    throw new Error("Canvas capture is unavailable for video compression.");
  }

  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is unavailable for video compression.");
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  const placement = getVideoContainPlacementRect(
    metadata.width,
    metadata.height,
    galleryThumbnailVideoCompressionPreset.targetWidth,
    galleryThumbnailVideoCompressionPreset.targetHeight,
  );

  const captureStream = canvas.captureStream(galleryThumbnailVideoCompressionPreset.frameRate);
  let frameTimerId: number | null = null;
  let safetyTimerId: number | null = null;

  const mimeTypeCandidate = pickMediaRecorderMimeType();
  const recorder = mimeTypeCandidate
    ? new MediaRecorder(captureStream, {
        mimeType: mimeTypeCandidate,
        videoBitsPerSecond: galleryThumbnailVideoCompressionPreset.videoBitsPerSecond,
      })
    : new MediaRecorder(captureStream, {
        videoBitsPerSecond: galleryThumbnailVideoCompressionPreset.videoBitsPerSecond,
      });
  const recorderMimeType = normalizeVideoMimeType(
    recorder.mimeType || mimeTypeCandidate || "video/webm",
  );
  const chunks: Blob[] = [];

  const cleanupResources = () => {
    if (frameTimerId !== null) {
      window.clearInterval(frameTimerId);
      frameTimerId = null;
    }

    if (safetyTimerId !== null) {
      window.clearTimeout(safetyTimerId);
      safetyTimerId = null;
    }

    captureStream.getTracks().forEach((track) => track.stop());
    URL.revokeObjectURL(objectUrl);
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  const drawFrame = () => {
    context.fillStyle = "#ece7de";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      video,
      0,
      0,
      metadata.width,
      metadata.height,
      placement.x,
      placement.y,
      placement.width,
      placement.height,
    );
  };

  const stopCapture = () => {
    if (frameTimerId !== null) {
      window.clearInterval(frameTimerId);
      frameTimerId = null;
    }

    video.pause();
    drawFrame();

    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  try {
    await waitForVideoLoadedMetadata(video);
    drawFrame();

    const recordedBlobPromise = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        resolve(new Blob(chunks, { type: recorderMimeType }));
      }, { once: true });

      recorder.addEventListener("error", () => {
        reject(new Error("Video compression failed while recording."));
      }, { once: true });
    });

    recorder.start(250);
    frameTimerId = window.setInterval(
      drawFrame,
      Math.max(16, Math.round(1000 / galleryThumbnailVideoCompressionPreset.frameRate)),
    );

    let cleanupPlaybackWait: (() => void) | null = null;
    const playbackFinishedPromise = new Promise<void>((resolve, reject) => {
      const handleEnded = () => {
        cleanupPlaybackWait?.();
        resolve();
      };
      const handleError = () => {
        cleanupPlaybackWait?.();
        reject(new Error("Video playback failed during compression."));
      };
      const handleTimeout = () => {
        cleanupPlaybackWait?.();
        stopCapture();
        resolve();
      };
      cleanupPlaybackWait = () => {
        video.removeEventListener("ended", handleEnded);
        video.removeEventListener("error", handleError);

        if (safetyTimerId !== null) {
          window.clearTimeout(safetyTimerId);
          safetyTimerId = null;
        }
      };

      safetyTimerId = window.setTimeout(
        handleTimeout,
        getThumbnailCompressionPlaybackLimitMs(metadata.durationSeconds),
      );

      video.addEventListener("ended", handleEnded, { once: true });
      video.addEventListener("error", handleError, { once: true });
    });

    const playPromise = video.play();
    if (typeof playPromise?.catch === "function") {
      await playPromise.catch(() => {
        cleanupPlaybackWait?.();
        throw new Error("Video playback could not start for compression.");
      });
    }

    await playbackFinishedPromise;
    stopCapture();

    const blob = await recordedBlobPromise;
    if (blob.size <= 0) {
      throw new Error("Compressed thumbnail output was empty.");
    }

    return {
      blob,
      mimeType: recorderMimeType,
    };
  } finally {
    cleanupResources();
  }
}

export async function prepareThumbnailUploadFile(file: File): Promise<PreparedThumbnailUploadResult> {
  if (!isVideoThumbnailFile(file)) {
    return {
      file,
      didCompress: false,
      message: null,
      originalSize: file.size,
      finalSize: file.size,
    };
  }

  if (
    typeof document === "undefined"
    || typeof window === "undefined"
    || typeof URL === "undefined"
    || typeof HTMLVideoElement === "undefined"
  ) {
    return {
      file,
      didCompress: false,
      message: "Browser video compression is unavailable. Uploading the original video thumbnail.",
      originalSize: file.size,
      finalSize: file.size,
    };
  }

  const metadata = await loadVideoMetadata(file);
  if (!shouldCompressThumbnailVideo({
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    fileSize: file.size,
  })) {
    return {
      file,
      didCompress: false,
      message: null,
      originalSize: file.size,
      finalSize: file.size,
    };
  }

  const { blob, mimeType } = await compressVideoThumbnail(file, metadata);
  if (blob.size >= file.size) {
    return {
      file,
      didCompress: false,
      message: "Using the original video thumbnail because compression would not reduce file size.",
      originalSize: file.size,
      finalSize: file.size,
    };
  }

  const compressedFile = new File(
    [blob],
    buildCompressedThumbnailFileName(file.name, mimeType),
    {
      type: mimeType,
      lastModified: Date.now(),
    },
  );

  return {
    file: compressedFile,
    didCompress: true,
    message: `Compressed video thumbnail from ${formatBytes(file.size)} to ${formatBytes(compressedFile.size)} for gallery cards.`,
    originalSize: file.size,
    finalSize: compressedFile.size,
  };
}
