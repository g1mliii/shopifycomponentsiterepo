import Link from "next/link";

import type { PublicComponentCard as PublicComponentCardType } from "@/lib/components/public-types";

import { ThumbnailMedia } from "./ThumbnailMedia";

type PublicComponentCardProps = {
  component: PublicComponentCardType;
  thumbnailLoading?: "eager" | "lazy";
};

const createdAtFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatCreatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return createdAtFormatter.format(parsed);
}

export function PublicComponentCard({ component, thumbnailLoading = "lazy" }: PublicComponentCardProps) {
  return (
    <article
      data-testid="public-component-card"
      className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm"
    >
      <ThumbnailMedia
        alt={`${component.title} thumbnail`}
        src={component.thumbnail_url}
        mediaKind={component.media_kind}
        imageLoading={thumbnailLoading}
      />

      <div className="mt-3">
        <h2 className="line-clamp-2 text-base font-semibold tracking-tight text-zinc-900">{component.title}</h2>
        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{component.category}</p>
        <p className="mt-1 text-xs text-zinc-500">Uploaded {formatCreatedAt(component.created_at)}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={`/api/components/${encodeURIComponent(component.id)}/download`}
          className="inline-flex h-9 touch-manipulation items-center justify-center rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2"
        >
          Download
        </a>
        <Link
          href={`/components/${encodeURIComponent(component.id)}/sandbox`}
          prefetch={false}
          className="inline-flex h-9 touch-manipulation items-center justify-center rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2"
        >
          Edit/Preview
        </Link>
      </div>
    </article>
  );
}
