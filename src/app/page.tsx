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
      numberOfItems: result.total,
    },
  };

  const itemListJsonLd =
    result.components.length === 0
      ? null
      : {
          "@context": "https://schema.org",
          "@type": "ItemList",
          numberOfItems: result.total,
          itemListElement: result.components.slice(0, 10).map((component, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: getAbsoluteUrl(`/components/${component.id}/sandbox`),
            name: component.title,
            image: component.thumbnail_url,
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

      <PublicGalleryContent initialResult={result} />
    </main>
  );
}
