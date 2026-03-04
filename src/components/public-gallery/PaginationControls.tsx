import Link from "next/link";

function buildPageHref(basePath: string, targetPage: number, search: string, category: string | null): string {
  const params = new URLSearchParams();

  if (targetPage > 1) {
    params.set("page", String(targetPage));
  }

  if (search) {
    params.set("query", search);
  }

  if (category) {
    params.set("category", category);
  }

  const searchValue = params.toString();
  return searchValue ? `${basePath}?${searchValue}` : basePath;
}

type PaginationControlsProps = {
  basePath: string;
  page: number;
  totalPages: number;
  search: string;
  category: string | null;
};

export function PaginationControls({
  basePath,
  page,
  totalPages,
  search,
  category,
}: PaginationControlsProps) {
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;
  const prevHref = buildPageHref(basePath, page - 1, search, category);
  const nextHref = buildPageHref(basePath, page + 1, search, category);

  return (
    <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
      {canGoPrev ? (
        <Link
          href={prevHref}
          className="inline-flex h-10 touch-manipulation items-center rounded-full border-2 px-6 text-sm font-semibold transition-[transform,background-color,border-color,color] duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            borderColor: "color-mix(in srgb, var(--color-bark) 48%, var(--color-timber))",
            background: "var(--color-card)",
            color: "var(--foreground)",
            boxShadow: "0 1px 0 color-mix(in srgb, var(--color-bark) 28%, transparent)",
            "--tw-ring-color": "color-mix(in srgb, var(--color-moss) 30%, transparent)",
          } as React.CSSProperties}
        >
          ← Previous
        </Link>
      ) : (
        <span
          className="inline-flex h-10 items-center rounded-full border px-6 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--color-bark) 20%, var(--color-timber))",
            background: "var(--color-card)",
            color: "var(--color-muted-fg)",
            opacity: 0.62,
          }}
        >
          ← Previous
        </span>
      )}

      <p className="text-sm font-medium" style={{ color: "var(--color-muted-fg)" }}>
        Page{" "}
        <span style={{ color: "var(--foreground)" }}>{page}</span>
        <span style={{ color: "var(--color-bark)", margin: "0 0.4em" }}>/</span>
        {totalPages}
      </p>

      {canGoNext ? (
        <Link
          href={nextHref}
          className="inline-flex h-10 touch-manipulation items-center rounded-full px-6 text-sm font-semibold transition-[transform,background-color,color] duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            background: "var(--color-moss)",
            color: "var(--color-moss-fg)",
            boxShadow: "0 8px 20px -10px color-mix(in srgb, var(--color-moss) 60%, transparent)",
            "--tw-ring-color": "color-mix(in srgb, var(--color-moss) 40%, transparent)",
          } as React.CSSProperties}
        >
          Next →
        </Link>
      ) : (
        <span
          className="inline-flex h-10 items-center rounded-full border px-6 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--color-bark) 20%, var(--color-timber))",
            background: "var(--color-card)",
            color: "var(--color-muted-fg)",
            opacity: 0.62,
          }}
        >
          Next →
        </span>
      )}
    </nav>
  );
}
