"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { PublicComponentMediaKind } from "@/lib/components/public-types";

const FAILED_IMAGE_SRC_CACHE_MAX_ENTRIES = 256;
const failedImageSrcs = new Set<string>();

function rememberFailedImageSrc(src: string): void {
  if (failedImageSrcs.has(src)) {
    failedImageSrcs.delete(src);
  }

  failedImageSrcs.add(src);

  if (failedImageSrcs.size <= FAILED_IMAGE_SRC_CACHE_MAX_ENTRIES) {
    return;
  }

  const oldestSrc = failedImageSrcs.values().next().value as string | undefined;
  if (oldestSrc) {
    failedImageSrcs.delete(oldestSrc);
  }
}

type ThumbnailMediaProps = {
  alt: string;
  src: string | null;
  mediaKind: PublicComponentMediaKind;
  imageLoading?: "eager" | "lazy";
};

export function ThumbnailMedia({ alt, src, mediaKind, imageLoading = "lazy" }: ThumbnailMediaProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isVideoHovered, setIsVideoHovered] = useState(false);
  const [isVideoPinned, setIsVideoPinned] = useState(false);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const normalizedSrc = src?.trim() ?? "";
  const hasSource = normalizedSrc.length > 0;
  const imageFailed =
    mediaKind === "image" && hasSource && (failedImageSrc === normalizedSrc || failedImageSrcs.has(normalizedSrc));
  const shouldRenderVideoPreview = mediaKind === "video" && (isVideoHovered || isVideoPinned);

  const playVideoPreview = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const playPromise = video.play();
    if (typeof playPromise?.catch === "function") {
      playPromise.catch(() => {});
    }
  }, []);

  const pauseAndResetVideoPreview = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.pause();
    if (video.readyState >= 1) {
      try {
        video.currentTime = 0;
      } catch {
        // Some browsers can reject seek before enough data is available.
      }
    }
  }, []);

  const handleVideoPointerEnter = useCallback(() => {
    if (mediaKind !== "video") {
      return;
    }

    setIsVideoHovered(true);
    playVideoPreview();
  }, [mediaKind, playVideoPreview]);

  const handleVideoPointerLeaveOrCancel = useCallback(() => {
    if (mediaKind !== "video") {
      return;
    }

    setIsVideoHovered(false);
    if (isVideoPinned) {
      return;
    }

    pauseAndResetVideoPreview();
  }, [isVideoPinned, mediaKind, pauseAndResetVideoPreview]);

  const handleVideoPreviewToggle = useCallback(() => {
    if (mediaKind !== "video") {
      return;
    }

    setIsVideoPinned((current) => {
      const next = !current;
      if (next) {
        setIsVideoHovered(false);
        window.setTimeout(() => {
          playVideoPreview();
        }, 0);
      } else {
        setIsVideoHovered(false);
        pauseAndResetVideoPreview();
      }

      return next;
    });
  }, [mediaKind, pauseAndResetVideoPreview, playVideoPreview]);

  const handleVideoPreviewKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleVideoPreviewToggle();
  }, [handleVideoPreviewToggle]);

  return (
    <div
      data-testid="public-thumbnail-media"
      data-video-hovered={mediaKind === "video" ? String(isVideoHovered || isVideoPinned) : undefined}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-xl"
      style={{
        contain: "layout paint style",
        background: "var(--color-stone)",
      }}
      onPointerEnter={mediaKind === "video" ? handleVideoPointerEnter : undefined}
      onPointerLeave={mediaKind === "video" ? handleVideoPointerLeaveOrCancel : undefined}
      onPointerCancel={mediaKind === "video" ? handleVideoPointerLeaveOrCancel : undefined}
    >
      {mediaKind === "missing" ? (
        <div
          className="flex h-full w-full items-center justify-center text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--color-muted-fg)" }}
        >
          Thumbnail pending
        </div>
      ) : mediaKind === "image" && hasSource && !imageFailed ? (
        <Image
          src={normalizedSrc}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          loading={imageLoading}
          className="h-full w-full object-cover"
          onError={() => {
            rememberFailedImageSrc(normalizedSrc);
            setFailedImageSrc(normalizedSrc);
          }}
        />
      ) : mediaKind === "image" ? (
        <div
          className="flex h-full w-full items-center justify-center text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--color-muted-fg)" }}
        >
          Preview unavailable
        </div>
      ) : (
        shouldRenderVideoPreview ? (
          <video
            ref={videoRef}
            aria-label={alt}
            loop
            muted
            playsInline
            onLoadedData={isVideoHovered ? playVideoPreview : undefined}
            preload="auto"
            className="absolute inset-0 h-full w-full object-contain"
            src={normalizedSrc}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-xs font-medium uppercase tracking-wide"
            style={{ color: "var(--color-muted-fg)" }}
          >
            Preview available
          </div>
        )
      )}

      {mediaKind === "video" && hasSource ? (
        <button
          type="button"
          data-testid="thumbnail-preview-toggle"
          aria-label={shouldRenderVideoPreview ? "Pause video preview" : "Preview video"}
          aria-pressed={shouldRenderVideoPreview}
          onClick={handleVideoPreviewToggle}
          onKeyDown={handleVideoPreviewKeyDown}
          className="absolute right-3 bottom-3 inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold transition-[transform,background-color,border-color,color] duration-200 motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            borderColor: "color-mix(in srgb, var(--color-bark) 24%, var(--color-timber))",
            background: "color-mix(in srgb, var(--color-card) 86%, white)",
            color: "var(--foreground)",
            "--tw-ring-color": "color-mix(in srgb, var(--color-moss) 38%, transparent)",
          } as React.CSSProperties}
        >
          {shouldRenderVideoPreview ? "Pause preview" : "Preview video"}
        </button>
      ) : null}
    </div>
  );
}
