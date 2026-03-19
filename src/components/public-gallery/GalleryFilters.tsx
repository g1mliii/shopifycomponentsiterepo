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
    <section
      className="p-4 sm:p-5"
      style={{
        borderRadius: "2rem",
        border: "1px solid color-mix(in srgb, var(--color-timber) 50%, transparent)",
        background: "var(--color-card)",
        boxShadow: "var(--shadow-moss)",
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-medium" style={{ color: "var(--color-bark)" }}>
            Search
          </span>
          <input
            name="query"
            type="search"
            value={queryValue}
            onChange={(event) => setQueryValue(event.currentTarget.value)}
            placeholder="Search by title…"
            autoComplete="off"
            spellCheck={false}
            className="h-12 rounded-full border px-5 text-sm transition-[border-color,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              borderColor: "var(--color-timber)",
              background: "color-mix(in srgb, white 50%, transparent)",
              color: "var(--foreground)",
              /* ring via CSS custom property */
              "--tw-ring-color": "color-mix(in srgb, var(--color-moss) 30%, transparent)",
            } as React.CSSProperties}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm font-medium" style={{ color: "var(--color-bark)" }}>
            Category
          </span>
          <select
            name="category"
            value={categoryValue}
            onChange={(event) => setCategoryValue(event.currentTarget.value)}
            className="h-12 rounded-full border px-5 text-sm transition-[border-color,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 cursor-pointer"
            style={{
              borderColor: "var(--color-timber)",
              background: "color-mix(in srgb, white 50%, transparent)",
              color: "var(--foreground)",
              "--tw-ring-color": "color-mix(in srgb, var(--color-moss) 30%, transparent)",
            } as React.CSSProperties}
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

      <p
        className="mt-3 text-xs transition-opacity duration-300"
        style={{ color: "var(--color-muted-fg)", opacity: isPending ? 1 : 0.7 }}
        role="status"
        aria-live="polite"
      >
        {isPending ? "Updating results…" : "Results update automatically after you stop typing."}
      </p>
    </section>
  );
}
