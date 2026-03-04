import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";

import { getPublicComponentById, isValidComponentId } from "@/lib/components/component-by-id";
import { getPublicThumbnailUrl } from "@/lib/components/public-query";
import {
  BUSINESS_NAME,
  SITE_NAME,
  buildComponentDescription,
  getAbsoluteUrl,
  serializeJsonLd,
} from "@/lib/seo/site";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { SandboxClient } from "./SandboxClient";

type SandboxPageProps = {
  params: Promise<{ id: string }>;
};

const getComponentForPage = cache(async (id: string) => {
  if (!isValidComponentId(id)) {
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const { data: component, error } = await getPublicComponentById(supabase, id);

  if (error) {
    throw new Error("Failed to load component sandbox details.");
  }

  return component;
});

export async function generateMetadata({ params }: SandboxPageProps): Promise<Metadata> {
  const { id } = await params;

  if (!isValidComponentId(id)) {
    return {
      title: "Component Not Found",
      robots: {
        index: false,
        follow: false,
        nocache: true,
      },
    };
  }

  const component = await getComponentForPage(id);
  if (!component) {
    return {
      title: "Component Not Found",
      robots: {
        index: false,
        follow: false,
        nocache: true,
      },
    };
  }

  const pagePath = `/components/${component.id}/sandbox`;
  const title = `${component.title} Shopify Component`;
  const description = buildComponentDescription(component.title, component.category);

  return {
    title,
    description,
    alternates: {
      canonical: pagePath,
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url: getAbsoluteUrl(pagePath),
      images: [
        {
          url: getAbsoluteUrl("/opengraph-image"),
          width: 1200,
          height: 630,
          alt: `${component.title} component preview`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [getAbsoluteUrl("/twitter-image")],
    },
  };
}

export default async function ComponentSandboxPage({ params }: SandboxPageProps) {
  const { id } = await params;

  if (!isValidComponentId(id)) {
    notFound();
  }

  const component = await getComponentForPage(id);
  if (!component) {
    notFound();
  }

  const componentUrl = getAbsoluteUrl(`/components/${component.id}/sandbox`);
  const description = buildComponentDescription(component.title, component.category);
  const componentJsonLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: component.title,
    description,
    genre: component.category,
    url: componentUrl,
    image: getPublicThumbnailUrl(component.thumbnail_path),
    datePublished: component.created_at,
    inLanguage: "en",
    publisher: {
      "@type": "Organization",
      name: BUSINESS_NAME,
      url: getAbsoluteUrl("/"),
    },
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: getAbsoluteUrl("/"),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(componentJsonLd) }}
      />
      <SandboxClient component={component} />
    </>
  );
}
