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
          className="inline-flex h-9 touch-manipulation items-center rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2"
        >
          Previous
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-sm text-zinc-400">
          Previous
        </span>
      )}

      <p className="text-sm text-zinc-600">
        Page {page} of {totalPages}
      </p>

      {canGoNext ? (
        <Link
          href={nextHref}
          className="inline-flex h-9 touch-manipulation items-center rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2"
        >
          Next
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-sm text-zinc-400">
          Next
        </span>
      )}
    </nav>
  );
}
