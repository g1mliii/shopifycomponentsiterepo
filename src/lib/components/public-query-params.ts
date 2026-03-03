import type { PublicComponentsQuery } from "./public-types";

export const PUBLIC_COMPONENTS_PAGE_SIZE = 12;
export const PUBLIC_QUERY_MAX_LENGTH = 64;
export const PUBLIC_CATEGORY_MAX_LENGTH = 48;

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function getSingleSearchParamValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return "";
}

function getSearchParam(source: URLSearchParams | SearchParamsRecord, key: string): string {
  if (source instanceof URLSearchParams) {
    return source.get(key) ?? "";
  }

  return getSingleSearchParamValue(source[key]);
}

function parsePage(rawValue: string): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function normalizeQuery(rawValue: string): string {
  return rawValue.trim().replace(/\s+/g, " ").slice(0, PUBLIC_QUERY_MAX_LENGTH);
}

function normalizeCategory(rawValue: string): string | null {
  const normalized = rawValue.trim().toLowerCase().slice(0, PUBLIC_CATEGORY_MAX_LENGTH);
  return normalized.length > 0 ? normalized : null;
}

export function parsePublicComponentsQuery(
  searchParams: URLSearchParams | SearchParamsRecord,
): PublicComponentsQuery {
  return {
    page: parsePage(getSearchParam(searchParams, "page")),
    limit: PUBLIC_COMPONENTS_PAGE_SIZE,
    query: normalizeQuery(getSearchParam(searchParams, "query")),
    category: normalizeCategory(getSearchParam(searchParams, "category")),
  };
}
