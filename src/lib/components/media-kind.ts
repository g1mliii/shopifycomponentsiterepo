import type { PublicComponentMediaKind } from "./public-types";

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);

function getExtension(path: string | null): string {
  if (!path) {
    return "";
  }

  const lastDot = path.lastIndexOf(".");
  if (lastDot < 0) {
    return "";
  }
  return path.slice(lastDot).toLowerCase();
}

export function getMediaKindFromThumbnailPath(thumbnailPath: string | null): PublicComponentMediaKind {
  if (!thumbnailPath) {
    return "missing";
  }

  return VIDEO_EXTENSIONS.has(getExtension(thumbnailPath)) ? "video" : "image";
}

export function isVideoThumbnailPath(thumbnailPath: string | null): boolean {
  return getMediaKindFromThumbnailPath(thumbnailPath) === "video";
}
