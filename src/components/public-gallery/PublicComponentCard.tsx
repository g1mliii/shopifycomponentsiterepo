"use client";

import Link from "next/link";

import type { PublicComponentCard as PublicComponentCardType } from "@/lib/components/public-types";

import { ThumbnailMedia } from "./ThumbnailMedia";

type PublicComponentCardProps = {
  component: PublicComponentCardType;
  thumbnailLoading?: "eager" | "lazy";
  /** 0-2: cycles through three card radius patterns */
  variant?: 0 | 1 | 2;
};

const CARD_RADII: Record<0 | 1 | 2, string> = {
  0: "2rem",
  1: "2rem 1rem 2rem 1.5rem",
  2: "1.5rem 2rem 1rem 2rem",
};

export function PublicComponentCard({
  component,
  thumbnailLoading = "lazy",
  variant = 0,
}: PublicComponentCardProps) {
  return (
    <article
      data-testid="public-component-card"
      className="flex flex-col transition-transform duration-200 motion-safe:hover:-translate-y-0.5"
      style={{
        contain: "layout paint style",
        contentVisibility: "auto",
        containIntrinsicSize: "340px 420px",
        borderRadius: CARD_RADII[variant],
        border: "1px solid color-mix(in srgb, var(--color-timber) 55%, transparent)",
        background: "var(--color-card)",
        boxShadow: "var(--shadow-moss)",
        padding: "0.75rem",
      }}
    >
      <ThumbnailMedia
        alt={`${component.title} thumbnail`}
        src={component.thumbnail_url}
        mediaKind={component.media_kind}
        imageLoading={thumbnailLoading}
      />

      <div className="mt-3 flex-1 px-1">
        <h2
          className="line-clamp-2 text-base font-semibold tracking-tight"
          style={{ color: "var(--foreground)" }}
        >
          {component.title}
        </h2>
        <p
          className="mt-1 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-clay)" }}
        >
          {component.category}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 px-1">
        <a
          href={`/api/components/${encodeURIComponent(component.id)}/download`}
          className="inline-flex h-10 touch-manipulation items-center justify-center rounded-full px-4 text-sm font-semibold transition-[transform,color,background-color,border-color] duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            border: "2px solid var(--color-clay)",
            background: "var(--color-card)",
            color: "var(--color-clay)",
            "--tw-ring-color": "color-mix(in srgb, var(--color-clay) 40%, transparent)",
          } as React.CSSProperties}
        >
          Download
        </a>

        <Link
          href={`/components/${encodeURIComponent(component.id)}/sandbox`}
          prefetch={false}
          className="inline-flex h-10 touch-manipulation items-center justify-center rounded-full px-4 text-sm font-semibold transition-[transform,background-color,color] duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            background: "var(--color-clay)",
            color: "var(--foreground)",
            boxShadow: "var(--shadow-clay)",
            "--tw-ring-color": "color-mix(in srgb, var(--color-clay) 40%, transparent)",
          } as React.CSSProperties}
        >
          Edit/Preview
        </Link>
      </div>
    </article>
  );
}
