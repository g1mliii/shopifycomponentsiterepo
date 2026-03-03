export interface InMemoryRateLimitOptions {
  windowMs: number;
  maxRequests: number;
  maxEntries: number;
}

export interface InMemoryRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  resetAtMs: number;
}

type InMemoryRateLimitEntry = {
  hits: number[];
  updatedAtMs: number;
};

const DEFAULT_OPTIONS: InMemoryRateLimitOptions = {
  windowMs: 60_000,
  maxRequests: 20,
  maxEntries: 2_000,
};
const STALE_PRUNE_INTERVAL_MS = 1_000;
const STALE_PRUNE_SCAN_LIMIT = 256;

const entries = new Map<string, InMemoryRateLimitEntry>();
let lastStalePruneAtMs = 0;
let stalePruneIterator: IterableIterator<[string, InMemoryRateLimitEntry]> | null = null;

function pruneOldHits(hits: number[], cutoffMs: number): number[] {
  if (hits.length === 0) {
    return hits;
  }

  let startIndex = 0;
  while (startIndex < hits.length && hits[startIndex] <= cutoffMs) {
    startIndex += 1;
  }

  return startIndex > 0 ? hits.slice(startIndex) : hits;
}

function pruneStaleEntriesBatch(nowMs: number, windowMs: number, maxEntriesToScan: number): void {
  if (entries.size === 0 || maxEntriesToScan <= 0) {
    stalePruneIterator = null;
    return;
  }

  const cutoffMs = nowMs - windowMs;
  if (!stalePruneIterator) {
    stalePruneIterator = entries.entries();
  }

  let scannedEntries = 0;
  while (scannedEntries < maxEntriesToScan) {
    const nextEntry = stalePruneIterator.next();
    if (nextEntry.done) {
      stalePruneIterator = entries.entries();
      break;
    }

    scannedEntries += 1;
    const [key, entry] = nextEntry.value;
    if (entry.updatedAtMs <= cutoffMs) {
      entries.delete(key);
    }
  }
}

function maybePruneStaleEntries(nowMs: number, windowMs: number): void {
  if (entries.size === 0) {
    lastStalePruneAtMs = nowMs;
    return;
  }

  const pruneIntervalMs = Math.min(STALE_PRUNE_INTERVAL_MS, windowMs);
  if (nowMs - lastStalePruneAtMs < pruneIntervalMs) {
    return;
  }

  pruneStaleEntriesBatch(nowMs, windowMs, Math.min(entries.size, STALE_PRUNE_SCAN_LIMIT));
  lastStalePruneAtMs = nowMs;
}

function pruneToMaxEntries(maxEntries: number): void {
  if (maxEntries <= 0) {
    entries.clear();
    stalePruneIterator = null;
    return;
  }

  if (entries.size <= maxEntries) {
    return;
  }

  while (entries.size > maxEntries) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    entries.delete(oldestKey);
  }

  if (entries.size === 0) {
    stalePruneIterator = null;
  }
}

function upsertTouchedEntry(key: string, entry: InMemoryRateLimitEntry): void {
  if (entries.has(key)) {
    entries.delete(key);
  }

  entries.set(key, entry);
}

export function consumeInMemoryRateLimit(
  key: string,
  options?: Partial<InMemoryRateLimitOptions>,
  nowMs = Date.now(),
): InMemoryRateLimitResult {
  const mergedOptions: InMemoryRateLimitOptions = {
    windowMs: options?.windowMs ?? DEFAULT_OPTIONS.windowMs,
    maxRequests: options?.maxRequests ?? DEFAULT_OPTIONS.maxRequests,
    maxEntries: options?.maxEntries ?? DEFAULT_OPTIONS.maxEntries,
  };

  if (!key) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: mergedOptions.maxRequests,
      resetAtMs: nowMs + mergedOptions.windowMs,
    };
  }

  maybePruneStaleEntries(nowMs, mergedOptions.windowMs);

  const existingEntry = entries.get(key);
  const prunedHits = pruneOldHits(existingEntry?.hits ?? [], nowMs - mergedOptions.windowMs);

  const entry: InMemoryRateLimitEntry = {
    hits: prunedHits,
    updatedAtMs: nowMs,
  };

  if (entry.hits.length >= mergedOptions.maxRequests) {
    upsertTouchedEntry(key, entry);
    pruneToMaxEntries(mergedOptions.maxEntries);

    const oldestAllowedHit = entry.hits[0] ?? nowMs;
    const resetAtMs = oldestAllowedHit + mergedOptions.windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));

    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
      resetAtMs,
    };
  }

  entry.hits.push(nowMs);
  entry.updatedAtMs = nowMs;

  upsertTouchedEntry(key, entry);
  pruneToMaxEntries(mergedOptions.maxEntries);

  const remaining = Math.max(0, mergedOptions.maxRequests - entry.hits.length);
  const resetAtMs = (entry.hits[0] ?? nowMs) + mergedOptions.windowMs;

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining,
    resetAtMs,
  };
}

export function clearInMemoryRateLimitForTests(): void {
  entries.clear();
  lastStalePruneAtMs = 0;
  stalePruneIterator = null;
}
