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
      <main className="mx-auto flex min-h-dvh w-full max-w-6xl items-center justify-center px-6 py-12">
        <section className="w-full max-w-xl rounded-2xl border border-red-300 bg-red-50 p-6">
          <h1 className="text-xl font-semibold tracking-tight text-red-900">Gallery unavailable</h1>
          <p className="mt-2 text-sm text-red-800">{loadErrorMessage ?? "Failed to load public components."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Shopify Components</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Browse production-ready Liquid blocks with fast previews and one-click downloads.
        </p>
      </header>

      <GalleryFilters
        categories={result.categories}
        initialQuery={result.query}
        initialCategory={result.category}
      />

      <section className="mt-4">
        <p className="text-sm text-zinc-600">
          {result.total} result{result.total === 1 ? "" : "s"}
        </p>

        {result.components.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
            No components matched your current filters.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.components.map((component, index) => (
              <PublicComponentCard
                key={component.id}
                component={component}
                thumbnailLoading={index < EAGER_THUMBNAIL_COUNT ? "eager" : "lazy"}
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
