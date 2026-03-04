import { GalleryFilters } from "@/components/public-gallery/GalleryFilters";
import { PaginationControls } from "@/components/public-gallery/PaginationControls";
import { PublicComponentCard } from "@/components/public-gallery/PublicComponentCard";
import {
  listPublicComponentsCached,
  parsePublicComponentsQuery,
} from "@/lib/components/public-query";
import type { PublicComponentsResult } from "@/lib/components/public-types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const EAGER_THUMBNAIL_COUNT = 3;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams =
    (await searchParams) ?? ({} as Record<string, string | string[] | undefined>);

  const query = parsePublicComponentsQuery(resolvedSearchParams);
  let result: PublicComponentsResult | null = null;
  let loadErrorMessage: string | null = null;

  try {
    const supabase = await createServerSupabaseClient();
    result = await listPublicComponentsCached(supabase, query);
  } catch (error) {
    loadErrorMessage = error instanceof Error ? error.message : "Failed to load public components.";
  }

  if (!result) {
    return (
      <main className="relative mx-auto flex min-h-dvh w-full max-w-6xl items-center justify-center overflow-hidden px-6 py-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 -left-28 h-80 w-80 rounded-full opacity-25"
          style={{
            background:
              "radial-gradient(circle at center, color-mix(in srgb, var(--color-moss) 34%, transparent), transparent 72%)",
          }}
        />
        <section
          className="relative w-full max-w-xl p-6"
          style={{
            borderRadius: "2rem",
            border: "1px solid color-mix(in srgb, var(--color-timber) 50%, transparent)",
            background: "var(--color-card)",
            boxShadow: "var(--shadow-moss)",
          }}
        >
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
            Gallery unavailable
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--color-muted-fg)" }}>
            {loadErrorMessage ?? "Failed to load public components."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="relative mx-auto min-h-dvh w-full max-w-6xl overflow-hidden px-5 py-8 sm:px-6 sm:py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -left-40 h-[460px] w-[460px] rounded-full opacity-[0.24]"
        style={{
          background:
            "radial-gradient(circle at center, color-mix(in srgb, var(--color-moss) 36%, transparent), transparent 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-24 -right-40 h-80 w-80 rounded-full opacity-[0.16]"
        style={{
          background:
            "radial-gradient(circle at center, color-mix(in srgb, var(--color-clay) 34%, transparent), transparent 74%)",
        }}
      />

      <header className="relative mb-6">
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--color-clay)" }}
        >
          Component Library
        </p>
        <h1
          className="text-3xl font-bold tracking-tight sm:text-4xl"
          style={{ color: "var(--foreground)" }}
        >
          Shopify Components
        </h1>
        <p
          className="mt-2 max-w-lg text-sm leading-relaxed"
          style={{ color: "var(--color-muted-fg)" }}
        >
          Browse production-ready Liquid blocks with fast previews and one-click downloads.
        </p>
        {/* Decorative underline */}
        <div
          className="mt-4 h-px w-16 rounded-full"
          style={{ background: "var(--color-moss)", opacity: 0.5 }}
          aria-hidden="true"
        />
      </header>

      <GalleryFilters
        categories={result.categories}
        initialQuery={result.query}
        initialCategory={result.category}
      />

      <section className="relative mt-5">
        <p className="mb-4 text-sm" style={{ color: "var(--color-muted-fg)" }}>
          {result.total} result{result.total === 1 ? "" : "s"}
        </p>

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
          search={result.query}
          category={result.category}
        />
      </section>
    </main>
  );
}
