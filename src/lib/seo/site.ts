const LOCALHOST_ORIGIN = "http://localhost:3000";

export const BUSINESS_NAME = "Shopify Components";
export const SITE_NAME = "Shopify Components";
export const SITE_SHORT_NAME = "Shopify Components";
export const SITE_DESCRIPTION =
  "Browse production-ready Shopify Liquid components with fast previews and one-click downloads.";
export const DEFAULT_LOCALE = "en_US";
export const DEFAULT_KEYWORDS = [
  "shopify components",
  "shopify liquid blocks",
  "shopify section templates",
  "shopify theme components",
  "shopify snippets",
  "shopify ecommerce components",
  "liquid template marketplace",
  "shopify ui blocks",
];

function isHttpProtocol(protocol: string): protocol is "http:" | "https:" {
  return protocol === "http:" || protocol === "https:";
}

function parseAbsoluteOrigin(rawValue: string | undefined): URL | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = new URL(rawValue);
    if (!isHttpProtocol(parsed.protocol)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function getSiteUrl(): URL {
  return (
    parseAbsoluteOrigin(process.env.APP_ORIGIN) ??
    parseAbsoluteOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
    new URL(LOCALHOST_ORIGIN)
  );
}

export function getAbsoluteUrl(pathname = "/"): string {
  return new URL(pathname, getSiteUrl()).toString();
}

export function getTwitterHandle(): string | undefined {
  const rawHandle = process.env.NEXT_PUBLIC_TWITTER_HANDLE?.trim();
  if (!rawHandle) {
    return undefined;
  }

  return rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;
}

export function buildComponentDescription(title: string, category: string): string {
  const normalizedCategory = category.trim().toLowerCase();
  return `${title} is a production-ready Shopify ${normalizedCategory} component with live preview and downloadable Liquid code.`;
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
