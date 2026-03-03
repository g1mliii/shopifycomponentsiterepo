"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type GalleryFiltersProps = {
  categories: string[];
  initialQuery: string;
  initialCategory: string | null;
};

const SEARCH_DEBOUNCE_MS = 300;

export function GalleryFilters({
  categories,
  initialQuery,
  initialCategory,
}: GalleryFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsSnapshot = searchParams.toString();
  const [isPending, startTransition] = useTransition();
  const [queryValue, setQueryValue] = useState(initialQuery);
  const [categoryValue, setCategoryValue] = useState(initialCategory ?? "");

  useEffect(() => {
    setQueryValue(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setCategoryValue(initialCategory ?? "");
  }, [initialCategory]);

  useEffect(() => {
    const normalizedQuery = queryValue.trim();
    const normalizedCategory = categoryValue.trim().toLowerCase();
    const currentParams = new URLSearchParams(searchParamsSnapshot);
    const currentQuery = (currentParams.get("query") ?? "").trim();
    const currentCategory = (currentParams.get("category") ?? "").trim().toLowerCase();

    if (normalizedQuery === currentQuery && normalizedCategory === currentCategory) {
      return;
    }

    const timer = window.setTimeout(() => {
      const nextParams = new URLSearchParams(searchParamsSnapshot);

      if (normalizedQuery) {
        nextParams.set("query", normalizedQuery);
      } else {
        nextParams.delete("query");
      }

      if (normalizedCategory) {
        nextParams.set("category", normalizedCategory);
      } else {
        nextParams.delete("category");
      }

      nextParams.set("page", "1");

      const nextSearch = nextParams.toString();
      const nextUrl = nextSearch.length > 0 ? `${pathname}?${nextSearch}` : pathname;

      startTransition(() => {
        router.replace(nextUrl, { scroll: false });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [categoryValue, pathname, queryValue, router, searchParamsSnapshot, startTransition]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-medium text-zinc-700">Search</span>
          <input
            type="search"
            value={queryValue}
            onChange={(event) => setQueryValue(event.currentTarget.value)}
            placeholder="Search by title"
            autoComplete="off"
            spellCheck={false}
            className="h-10 rounded-lg border border-zinc-300 px-3 text-sm text-zinc-900 transition-colors focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium text-zinc-700">Category</span>
          <select
            value={categoryValue}
            onChange={(event) => setCategoryValue(event.currentTarget.value)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 transition-colors focus-visible:border-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-3 text-xs text-zinc-500" role="status" aria-live="polite">
        {isPending ? "Updating results..." : "Results update automatically after you stop typing."}
      </p>
    </section>
  );
}
