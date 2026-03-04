"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { PublicComponentMediaKind } from "@/lib/components/public-types";

const VIDEO_VISIBILITY_ROOT_MARGIN = "80px";
const VIDEO_VISIBILITY_THRESHOLD = 0.25;
const FAILED_IMAGE_SRC_CACHE_MAX_ENTRIES = 256;
const MAX_ACTIVE_VIDEO_PREVIEWS = 3;

type VisibilityCallback = (isVisible: boolean) => void;
type ActivationCallback = () => void;

const observerCallbacks = new Map<Element, VisibilityCallback>();
let sharedVideoObserver: IntersectionObserver | null = null;
const failedImageSrcs = new Set<string>();
const activeVideoPreviewSlots = new Set<Element>();
const activationCallbacks = new Map<Element, ActivationCallback>();

function getSharedVideoObserver(): IntersectionObserver {
  if (sharedVideoObserver) {
    return sharedVideoObserver;
  }

  sharedVideoObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const callback = observerCallbacks.get(entry.target);
        if (callback) {
          callback(entry.isIntersecting);
        }
      }
    },
    {
      root: null,
      rootMargin: VIDEO_VISIBILITY_ROOT_MARGIN,
      threshold: VIDEO_VISIBILITY_THRESHOLD,
    },
  );

  return sharedVideoObserver;
}

function observeVideoVisibility(element: Element, callback: VisibilityCallback): () => void {
  const observer = getSharedVideoObserver();
  observerCallbacks.set(element, callback);
  observer.observe(element);

  return () => {
    observer.unobserve(element);
    observerCallbacks.delete(element);

    if (observerCallbacks.size === 0) {
      observer.disconnect();
      sharedVideoObserver = null;
    }
  };
}

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

function tryAcquireVideoPreviewSlot(element: Element): boolean {
  if (activeVideoPreviewSlots.has(element)) {
    return true;
  }

  if (activeVideoPreviewSlots.size >= MAX_ACTIVE_VIDEO_PREVIEWS) {
    return false;
  }

  activeVideoPreviewSlots.add(element);
  return true;
}

function releaseVideoPreviewSlot(element: Element): void {
  if (!activeVideoPreviewSlots.delete(element)) {
    return;
  }

  if (activeVideoPreviewSlots.size >= MAX_ACTIVE_VIDEO_PREVIEWS) {
    return;
  }

  for (const [candidate, callback] of activationCallbacks.entries()) {
    if (activeVideoPreviewSlots.size >= MAX_ACTIVE_VIDEO_PREVIEWS) {
      break;
    }

    if (activeVideoPreviewSlots.has(candidate)) {
      continue;
    }

    callback();
  }
}

function registerActivationCallback(element: Element, callback: ActivationCallback): () => void {
  activationCallbacks.set(element, callback);

  return () => {
    activationCallbacks.delete(element);
  };
}

type ThumbnailMediaProps = {
  alt: string;
  src: string;
  mediaKind: PublicComponentMediaKind;
  imageLoading?: "eager" | "lazy";
};

export function ThumbnailMedia({ alt, src, mediaKind, imageLoading = "lazy" }: ThumbnailMediaProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isIntersectingRef = useRef(false);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const imageFailed =
    mediaKind === "image" && (failedImageSrc === src || failedImageSrcs.has(src));

  useEffect(() => {
    if (mediaKind !== "video") {
      return;
    }

    const node = containerRef.current;
    if (!node) {
      return;
    }

    const tryActivateVideo = () => {
      if (!isIntersectingRef.current) {
        return;
      }

      const nextActive = tryAcquireVideoPreviewSlot(node);
      setIsVideoActive((currentActive) => {
        if (currentActive === nextActive) {
          return currentActive;
        }

        return nextActive;
      });
    };

    const unregisterActivationCallback = registerActivationCallback(node, tryActivateVideo);

    const stopObserving = observeVideoVisibility(node, (nextVisible) => {
      isIntersectingRef.current = nextVisible;

      if (!nextVisible) {
        setIsVideoActive(false);
        releaseVideoPreviewSlot(node);
        return;
      }

      const nextActive = tryAcquireVideoPreviewSlot(node);
      setIsVideoActive((currentActive) => {
        if (currentActive === nextActive) {
          return currentActive;
        }

        return nextActive;
      });
    });

    return () => {
      isIntersectingRef.current = false;
      stopObserving();
      unregisterActivationCallback();
      releaseVideoPreviewSlot(node);
    };
  }, [mediaKind]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-[4/3] w-full overflow-hidden rounded-xl"
      style={{
        contain: "layout paint style",
        background: "var(--color-stone)",
      }}
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
      ) : isVideoActive ? (
        <video
          aria-label={alt}
          autoPlay
          loop
          muted
          playsInline
          preload="none"
          className="h-full w-full object-cover"
          src={src}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--color-muted-fg)" }}
        >
          Video preview
        </div>
      )}
    </div>
  );
}
