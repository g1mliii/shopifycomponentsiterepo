import type { PublicComponentMediaKind } from "./public-types";

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);

function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot < 0) {
    return "";
  }
  return path.slice(lastDot).toLowerCase();
}

export function getMediaKindFromThumbnailPath(thumbnailPath: string): PublicComponentMediaKind {
  return VIDEO_EXTENSIONS.has(getExtension(thumbnailPath)) ? "video" : "image";
}

export function isVideoThumbnailPath(thumbnailPath: string): boolean {
  return getMediaKindFromThumbnailPath(thumbnailPath) === "video";
}
