"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

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
  src: string;
  mediaKind: PublicComponentMediaKind;
  imageLoading?: "eager" | "lazy";
};

export function ThumbnailMedia({ alt, src, mediaKind, imageLoading = "lazy" }: ThumbnailMediaProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isVideoHovered, setIsVideoHovered] = useState(false);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const imageFailed =
    mediaKind === "image" && (failedImageSrc === src || failedImageSrcs.has(src));

  useEffect(() => {
    if (mediaKind !== "video") {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (isVideoHovered) {
      const playPromise = video.play();
      if (typeof playPromise?.catch === "function") {
        playPromise.catch(() => {});
      }
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
  }, [isVideoHovered, mediaKind, src]);

  return (
    <div
      data-testid="public-thumbnail-media"
      data-video-hovered={mediaKind === "video" ? String(isVideoHovered) : undefined}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-xl"
      style={{
        contain: "layout paint style",
        background: "var(--color-stone)",
      }}
      onPointerEnter={mediaKind === "video" ? () => setIsVideoHovered(true) : undefined}
      onPointerLeave={mediaKind === "video" ? () => setIsVideoHovered(false) : undefined}
      onPointerCancel={mediaKind === "video" ? () => setIsVideoHovered(false) : undefined}
    >
      {mediaKind === "image" && !imageFailed ? (
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          loading={imageLoading}
          className="h-full w-full object-cover"
          onError={() => {
            rememberFailedImageSrc(src);
            setFailedImageSrc(src);
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
        <>
          <video
            ref={videoRef}
            aria-label={alt}
            loop
            muted
            playsInline
            preload={isVideoHovered ? "auto" : "metadata"}
            className="absolute inset-0 h-full w-full object-cover"
            src={src}
          />
        </>
      )}
    </div>
  );
}
