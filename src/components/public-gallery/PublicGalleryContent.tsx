"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { parsePublicComponentsQuery } from "@/lib/components/public-query-params";
import type { PublicComponentsQuery, PublicComponentsResult } from "@/lib/components/public-types";

import { GalleryFilters } from "./GalleryFilters";
import { PaginationControls } from "./PaginationControls";
import { PublicComponentCard } from "./PublicComponentCard";

const EAGER_THUMBNAIL_COUNT = 3;

type ComponentsApiSuccessPayload = PublicComponentsResult & {
  requestId?: string;
};

type ComponentsApiErrorPayload = {
  error?: {
    message?: string;
  };
};

function getQueryKey(query: PublicComponentsQuery): string {
  return `${query.page}|${query.query}|${query.category ?? ""}`;
}

function toRequestPath(query: PublicComponentsQuery): string {
  const params = new URLSearchParams();

  if (query.page > 1) {
    params.set("page", String(query.page));
  }

  if (query.query) {
    params.set("query", query.query);
  }

  if (query.category) {
    params.set("category", query.category);
  }

  const search = params.toString();
  return search.length > 0 ? `/api/components?${search}` : "/api/components";
}

function isPublicComponentsResult(value: unknown): value is PublicComponentsResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    Array.isArray(payload.components)
    && Array.isArray(payload.categories)
    && typeof payload.page === "number"
    && typeof payload.limit === "number"
    && typeof payload.total === "number"
    && typeof payload.totalPages === "number"
    && typeof payload.query === "string"
    && (typeof payload.category === "string" || payload.category === null)
  );
}

type PublicGalleryContentProps = {
  initialResult: PublicComponentsResult;
};

export function PublicGalleryContent({ initialResult }: PublicGalleryContentProps) {
  const searchParams = useSearchParams();

  const currentQuery = useMemo(
    () => parsePublicComponentsQuery(searchParams),
    [searchParams],
  );
  const currentQueryKey = useMemo(() => getQueryKey(currentQuery), [currentQuery]);

  const initialQueryKey = useMemo(
    () =>
      getQueryKey({
        page: initialResult.page,
        limit: initialResult.limit,
        query: initialResult.query,
        category: initialResult.category,
      }),
    [initialResult.category, initialResult.limit, initialResult.page, initialResult.query],
  );

  const [result, setResult] = useState<PublicComponentsResult>(initialResult);
  const [activeQueryKey, setActiveQueryKey] = useState(initialQueryKey);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (currentQueryKey === activeQueryKey) {
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setLoadErrorMessage(null);

    void (async () => {
      try {
        const response = await fetch(toRequestPath(currentQuery), {
          method: "GET",
          signal: controller.signal,
          headers: {
            accept: "application/json",
          },
          cache: "default",
        });

        const payload = (await response
          .json()
          .catch(() => null)) as ComponentsApiSuccessPayload | ComponentsApiErrorPayload | null;

        if (!response.ok) {
          const message = payload && "error" in payload ? payload.error?.message : null;
          throw new Error(message || "Failed to load public components.");
        }

        if (!isPublicComponentsResult(payload)) {
          throw new Error("Public components response was malformed.");
        }

        if (controller.signal.aborted) {
          return;
        }

        setResult(payload);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setLoadErrorMessage(
          error instanceof Error ? error.message : "Failed to load public components.",
        );
      } finally {
        if (controller.signal.aborted) {
          return;
        }

        setActiveQueryKey(currentQueryKey);
        setIsLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [activeQueryKey, currentQuery, currentQueryKey]);

  return (
    <>
      <GalleryFilters
        categories={result.categories}
        initialQuery={currentQuery.query}
        initialCategory={currentQuery.category}
      />

      <section className="relative mt-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm" style={{ color: "var(--color-muted-fg)" }}>
            {result.total} result{result.total === 1 ? "" : "s"}
          </p>
          {isLoading ? (
            <p className="text-xs font-medium" style={{ color: "var(--color-clay)" }}>
              Updating results…
            </p>
          ) : null}
        </div>

        {loadErrorMessage ? (
          <div
            className="mb-4 rounded-2xl border px-4 py-3 text-sm"
            style={{
              borderColor: "color-mix(in srgb, #dc2626 30%, transparent)",
              background: "color-mix(in srgb, #dc2626 8%, white)",
              color: "#7f1d1d",
            }}
          >
            {loadErrorMessage}
          </div>
        ) : null}

        {result.components.length === 0 ? (
          <div
            className="p-6 text-sm"
            style={{
              borderRadius: "2rem",
              border: "1px solid color-mix(in srgb, var(--color-timber) 50%, transparent)",
              background: "var(--color-card)",
              boxShadow: "var(--shadow-moss)",
              color: "var(--color-muted-fg)",
            }}
          >
            No components matched your current filters.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.components.map((component, index) => (
              <PublicComponentCard
                key={component.id}
                component={component}
                thumbnailLoading={index < EAGER_THUMBNAIL_COUNT ? "eager" : "lazy"}
                variant={(index % 3) as 0 | 1 | 2}
              />
            ))}
          </div>
        )}

        <PaginationControls
          basePath="/"
          page={result.page}
          totalPages={result.totalPages}
          search={currentQuery.query}
          category={currentQuery.category}
        />
      </section>
    </>
  );
}
