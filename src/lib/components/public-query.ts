import { type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { getMediaKindFromThumbnailPath } from "./media-kind";
import {
  parsePublicComponentsQuery,
  PUBLIC_CATEGORY_MAX_LENGTH,
  PUBLIC_COMPONENTS_PAGE_SIZE,
  PUBLIC_QUERY_MAX_LENGTH,
} from "./public-query-params";
import type {
  PublicComponentCard,
  PublicComponentsQuery,
  PublicComponentsResult,
} from "./public-types";

export const PUBLIC_RESULTS_CACHE_TTL_MS = 2 * 60 * 1000;
export const PUBLIC_RESULTS_CACHE_MAX_ENTRIES = 200;
export const PUBLIC_CATEGORIES_CACHE_KEY = "__categories__";

type PublicComponentsRow = {
  id: string;
  title: string;
  category: string;
  thumbnail_path: string | null;
  created_at: string;
};

type PublicCategoryRow = {
  category: string | null;
};

type PublicComponentsBatchRpcRow = {
  components: unknown;
  total: number | string | null;
  categories: unknown;
};

type PublicSupabaseClient = SupabaseClient;

type CacheEntry<T> = {
  value: T;
  expiresAtMs: number;
  lastAccessedAtMs: number;
};

const publicResultsCache = new Map<string, CacheEntry<PublicComponentsResult>>();
const publicCategoriesCache = new Map<string, CacheEntry<string[]>>();
const PUBLIC_COMPONENTS_BATCH_RPC_NAME = "list_public_components_batch";

function isPublicCacheDisabled(): boolean {
  return process.env.DISABLE_PUBLIC_COMPONENTS_CACHE === "true";
}

function serializeQueryKey(query: PublicComponentsQuery): string {
  return JSON.stringify({
    page: query.page,
    limit: query.limit,
    query: query.query,
    category: query.category,
  });
}

function pruneExpiredEntries<T>(cache: Map<string, CacheEntry<T>>, nowMs: number): void {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      cache.delete(key);
    }
  }
}

function pruneOldestEntries<T>(cache: Map<string, CacheEntry<T>>, maxEntries: number): void {
  if (cache.size <= maxEntries) {
    return;
  }

  const entries = Array.from(cache.entries()).sort(
    (a, b) => a[1].lastAccessedAtMs - b[1].lastAccessedAtMs,
  );

  for (const [key] of entries) {
    if (cache.size <= maxEntries) {
      break;
    }
    cache.delete(key);
  }
}

function getFromCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  nowMs: number,
): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAtMs <= nowMs) {
    cache.delete(key);
    return null;
  }

  entry.lastAccessedAtMs = nowMs;
  return entry.value;
}

function setCacheValue<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  nowMs: number,
  ttlMs: number,
  maxEntries: number,
): void {
  cache.set(key, {
    value,
    expiresAtMs: nowMs + ttlMs,
    lastAccessedAtMs: nowMs,
  });

  pruneOldestEntries(cache, maxEntries);
}

function toErrorMessage(error: unknown): string {
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "Unknown error";
}

function assertNoSupabaseError(error: PostgrestError | null, fallbackMessage: string): void {
  if (!error) {
    return;
  }

  throw new Error(`${fallbackMessage}: ${error.message}`);
}

function isMissingBatchRpcError(error: PostgrestError): boolean {
  if (error.code === "PGRST202") {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes("could not find the function");
}

function mapRowsToPublicCards(rows: PublicComponentsRow[]): PublicComponentCard[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    thumbnail_path: row.thumbnail_path,
    created_at: row.created_at,
    thumbnail_url: getPublicThumbnailUrl(row.thumbnail_path),
    media_kind: getMediaKindFromThumbnailPath(row.thumbnail_path),
  }));
}

function parseBatchRpcRows(value: unknown): PublicComponentsRow[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const rows: PublicComponentsRow[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      return null;
    }

    const row = candidate as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.title !== "string" ||
      typeof row.category !== "string" ||
      !(typeof row.thumbnail_path === "string" || row.thumbnail_path === null) ||
      typeof row.created_at !== "string"
    ) {
      return null;
    }

    rows.push({
      id: row.id,
      title: row.title,
      category: row.category,
      thumbnail_path: row.thumbnail_path,
      created_at: row.created_at,
    });
  }

  return rows;
}

function parseBatchRpcCategories(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const categories: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") {
      return null;
    }

    const normalized = candidate.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    categories.push(normalized);
  }

  return categories;
}

function parseBatchRpcTotal(value: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return null;
}

async function listPublicComponentsViaBatchRpc(
  supabase: PublicSupabaseClient,
  query: PublicComponentsQuery,
): Promise<PublicComponentsResult | null> {
  const { data, error } = await supabase.rpc(PUBLIC_COMPONENTS_BATCH_RPC_NAME, {
    p_page: query.page,
    p_limit: query.limit,
    p_query: query.query || null,
    p_category: query.category,
  });

  if (error) {
    if (isMissingBatchRpcError(error)) {
      return null;
    }

    throw new Error(`Failed to load components: ${error.message}`);
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Failed to load components: empty batched payload.");
  }

  const firstRow = data[0] as PublicComponentsBatchRpcRow | undefined;
  if (!firstRow || typeof firstRow !== "object") {
    throw new Error("Failed to load components: malformed batched payload.");
  }

  const parsedRows = parseBatchRpcRows(firstRow.components);
  const parsedCategories = parseBatchRpcCategories(firstRow.categories);
  const parsedTotal = parseBatchRpcTotal(firstRow.total);

  if (!parsedRows || !parsedCategories || parsedTotal === null) {
    throw new Error("Failed to load components: invalid batched payload shape.");
  }

  const totalPages = parsedTotal > 0 ? Math.ceil(parsedTotal / query.limit) : 1;

  return {
    components: mapRowsToPublicCards(parsedRows),
    page: query.page,
    limit: query.limit,
    total: parsedTotal,
    totalPages,
    query: query.query,
    category: query.category,
    categories: parsedCategories,
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function encodeStoragePath(pathValue: string): string {
  return pathValue
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getPublicSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL",
    );
  }

  return value;
}

export function getPublicThumbnailUrl(pathValue: string | null): string | null {
  if (!pathValue) {
    return null;
  }

  return `${getPublicSupabaseUrl()}/storage/v1/object/public/component-thumbnails/${encodeStoragePath(pathValue)}`;
}

export {
  parsePublicComponentsQuery,
  PUBLIC_CATEGORY_MAX_LENGTH,
  PUBLIC_COMPONENTS_PAGE_SIZE,
  PUBLIC_QUERY_MAX_LENGTH,
};

export async function listPublicCategories(
  supabase: PublicSupabaseClient,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("shopify_components")
    .select("category")
    .order("category", { ascending: true })
    .limit(5000);

  assertNoSupabaseError(error, "Failed to load categories");

  const categorySet = new Set<string>();
  const rows = (data ?? []) as PublicCategoryRow[];

  for (const row of rows) {
    const category = typeof row.category === "string" ? row.category.trim().toLowerCase() : "";
    if (category) {
      categorySet.add(category);
    }
  }

  return Array.from(categorySet).sort((a, b) => a.localeCompare(b));
}

export async function listPublicCategoriesCached(
  supabase: PublicSupabaseClient,
  nowMs = Date.now(),
): Promise<string[]> {
  if (isPublicCacheDisabled()) {
    return listPublicCategories(supabase);
  }

  pruneExpiredEntries(publicCategoriesCache, nowMs);

  const cached = getFromCache(publicCategoriesCache, PUBLIC_CATEGORIES_CACHE_KEY, nowMs);
  if (cached) {
    return cached;
  }

  const categories = await listPublicCategories(supabase);

  setCacheValue(
    publicCategoriesCache,
    PUBLIC_CATEGORIES_CACHE_KEY,
    categories,
    nowMs,
    PUBLIC_RESULTS_CACHE_TTL_MS,
    1,
  );

  return categories;
}

export async function listPublicComponents(
  supabase: PublicSupabaseClient,
  query: PublicComponentsQuery,
): Promise<PublicComponentsResult> {
  const batchedResult = await listPublicComponentsViaBatchRpc(supabase, query);
  if (batchedResult) {
    return batchedResult;
  }

  return listPublicComponentsLegacy(supabase, query);
}

async function listPublicComponentsLegacy(
  supabase: PublicSupabaseClient,
  query: PublicComponentsQuery,
): Promise<PublicComponentsResult> {
  const offset = (query.page - 1) * query.limit;
  const rangeStart = offset;
  const rangeEnd = offset + query.limit - 1;

  let fetchQuery = supabase
    .from("shopify_components")
    .select("id, title, category, thumbnail_path, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(rangeStart, rangeEnd);

  if (query.query) {
    fetchQuery = fetchQuery.ilike("title", `%${escapeLikePattern(query.query)}%`);
  }

  if (query.category) {
    fetchQuery = fetchQuery.eq("category", query.category);
  }

  const [componentsResponse, categories] = await Promise.all([
    fetchQuery,
    listPublicCategoriesCached(supabase),
  ]);

  assertNoSupabaseError(componentsResponse.error, "Failed to load components");

  const rows = (componentsResponse.data ?? []) as PublicComponentsRow[];
  const total = typeof componentsResponse.count === "number" ? componentsResponse.count : 0;
  const totalPages = total > 0 ? Math.ceil(total / query.limit) : 1;
  const components = mapRowsToPublicCards(rows);

  return {
    components,
    page: query.page,
    limit: query.limit,
    total,
    totalPages,
    query: query.query,
    category: query.category,
    categories,
  };
}

export async function listPublicComponentsCached(
  supabase: PublicSupabaseClient,
  query: PublicComponentsQuery,
  nowMs = Date.now(),
): Promise<PublicComponentsResult> {
  if (isPublicCacheDisabled()) {
    return listPublicComponents(supabase, query);
  }

  pruneExpiredEntries(publicResultsCache, nowMs);

  const cacheKey = serializeQueryKey(query);
  const cachedResult = getFromCache(publicResultsCache, cacheKey, nowMs);
  if (cachedResult) {
    return cachedResult;
  }

  try {
    const result = await listPublicComponents(supabase, query);

    setCacheValue(
      publicResultsCache,
      cacheKey,
      result,
      nowMs,
      PUBLIC_RESULTS_CACHE_TTL_MS,
      PUBLIC_RESULTS_CACHE_MAX_ENTRIES,
    );

    return result;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export function clearPublicComponentsCacheForTests(): void {
  publicResultsCache.clear();
  publicCategoriesCache.clear();
}
