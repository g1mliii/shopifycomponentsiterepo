import type { Metadata } from "next";

import { PublicGalleryContent } from "@/components/public-gallery/PublicGalleryContent";
import {
  listPublicComponentsCached,
} from "@/lib/components/public-query";
import type { PublicComponentsResult } from "@/lib/components/public-types";
import { PUBLIC_COMPONENTS_PAGE_SIZE } from "@/lib/components/public-query-params";
import {
  BUSINESS_NAME,
  SITE_DESCRIPTION,
  SITE_NAME,
  getAbsoluteUrl,
  serializeJsonLd,
} from "@/lib/seo/site";
import { createPublicServerSupabaseClient } from "@/lib/supabase/public-server";

export const dynamic = "force-static";
export const revalidate = 120;

export const metadata: Metadata = {
  title: "Shopify Components Library",
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: getAbsoluteUrl("/"),
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

export default async function HomePage() {
  let result: PublicComponentsResult | null = null;
  let loadErrorMessage: string | null = null;

  try {
    const supabase = createPublicServerSupabaseClient();
    result = await listPublicComponentsCached(supabase, {
      page: 1,
      limit: PUBLIC_COMPONENTS_PAGE_SIZE,
      query: "",
      category: null,
    });
  } catch (error) {
    loadErrorMessage = error instanceof Error ? error.message : "Failed to load public components.";
  }
  const initialResult: PublicComponentsResult = result ?? {
    components: [],
    page: 1,
    limit: PUBLIC_COMPONENTS_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    query: "",
    category: null,
    categories: [],
  };

  const homeUrl = getAbsoluteUrl("/");
  const searchTargetUrl = `${homeUrl}?query={search_term_string}`;
  const webSiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: homeUrl,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: {
      "@type": "Organization",
      name: BUSINESS_NAME,
      url: homeUrl,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: searchTargetUrl,
      "query-input": "required name=search_term_string",
    },
  };

  const collectionPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${SITE_NAME} Component Catalog`,
    description: SITE_DESCRIPTION,
    url: homeUrl,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: homeUrl,
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: initialResult.total,
    },
  };

  const itemListJsonLd =
    initialResult.components.length === 0
      ? null
      : {
          "@context": "https://schema.org",
          "@type": "ItemList",
          numberOfItems: initialResult.total,
          itemListElement: initialResult.components.slice(0, 10).map((component, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: getAbsoluteUrl(`/components/${component.id}/sandbox`),
            name: component.title,
            image: component.thumbnail_url ?? undefined,
          })),
        };

  return (
    <main className="relative mx-auto min-h-dvh w-full max-w-6xl overflow-hidden px-5 py-8 sm:px-6 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(webSiteJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(collectionPageJsonLd) }}
      />
      {itemListJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListJsonLd) }}
        />
      ) : null}
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

      <header className="relative mb-8 max-w-3xl">
        <p className="page-eyebrow mb-2">
          Component Library
        </p>
        <h1
          className="font-display max-w-2xl text-4xl sm:text-5xl"
          style={{ color: "var(--foreground)" }}
        >
          Shopify components you can judge in seconds.
        </h1>
        <p
          className="page-subtitle mt-3 max-w-2xl"
        >
          Browse production-ready Liquid blocks, check motion and layout with live previews, and open the sandbox when you need to tune defaults before download.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="sandbox-badge">Live previews</span>
          <span className="sandbox-badge">Sandbox editing</span>
          <span className="sandbox-badge">Liquid downloads</span>
        </div>
      </header>

      <PublicGalleryContent
        initialResult={initialResult}
        initialLoadErrorMessage={loadErrorMessage}
      />
    </main>
  );
}
