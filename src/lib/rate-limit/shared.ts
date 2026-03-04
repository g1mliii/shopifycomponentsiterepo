import type { SupabaseClient } from "@supabase/supabase-js";

import { consumeInMemoryRateLimit, type InMemoryRateLimitResult } from "./in-memory";

const RATE_LIMIT_SCOPE_MAX_LENGTH = 64;
const RATE_LIMIT_KEY_MAX_LENGTH = 256;

type SharedRateLimitOptions = {
  key: string;
  scope: string;
  windowMs: number;
  maxRequests: number;
  fallbackMaxEntries: number;
};

type SharedRateLimitRpcRow = {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
  reset_at: string;
};

export type SharedRateLimitResult = InMemoryRateLimitResult & {
  source: "supabase" | "fallback_in_memory" | "fallback_blocked";
};

function isInMemoryFallbackDisabled(): boolean {
  return process.env.DISABLE_RATE_LIMIT_FALLBACK_IN_MEMORY === "true";
}

function shouldLogFallbackWarning(): boolean {
  return process.env.ENABLE_SHARED_RATE_LIMIT_FALLBACK_LOGS !== "false";
}

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase().slice(0, RATE_LIMIT_SCOPE_MAX_LENGTH);
}

function normalizeKey(key: string): string {
  return key.trim().slice(0, RATE_LIMIT_KEY_MAX_LENGTH);
}

function toRpcWindowSeconds(windowMs: number): number {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(windowMs / 1000));
}

function toSharedRow(data: unknown): SharedRateLimitRpcRow | null {
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const candidate = data[0];
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const row = candidate as Record<string, unknown>;
  if (
    typeof row.allowed !== "boolean" ||
    typeof row.remaining !== "number" ||
    typeof row.retry_after_seconds !== "number" ||
    typeof row.reset_at !== "string"
  ) {
    return null;
  }

  return {
    allowed: row.allowed,
    remaining: row.remaining,
    retry_after_seconds: row.retry_after_seconds,
    reset_at: row.reset_at,
  };
}

function toFallbackResult(
  key: string,
  options: SharedRateLimitOptions,
  nowMs: number,
): SharedRateLimitResult {
  if (isInMemoryFallbackDisabled()) {
    return {
      allowed: false,
      retryAfterSeconds: 5,
      remaining: 0,
      resetAtMs: nowMs + 5_000,
      source: "fallback_blocked",
    };
  }

  const fallback = consumeInMemoryRateLimit(
    key,
    {
      windowMs: options.windowMs,
      maxRequests: options.maxRequests,
      maxEntries: options.fallbackMaxEntries,
    },
    nowMs,
  );

  return {
    ...fallback,
    source: "fallback_in_memory",
  };
}

export async function consumeSharedRateLimit(
  supabase: SupabaseClient,
  options: SharedRateLimitOptions,
): Promise<SharedRateLimitResult> {
  const nowMs = Date.now();
  const normalizedScope = normalizeScope(options.scope);
  const normalizedKey = normalizeKey(options.key);

  if (!normalizedScope || !normalizedKey) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: options.maxRequests,
      resetAtMs: nowMs + options.windowMs,
      source: "fallback_in_memory",
    };
  }

  try {
    const { data, error } = await supabase.rpc("consume_public_rate_limit", {
      p_scope: normalizedScope,
      p_key: normalizedKey,
      p_window_seconds: toRpcWindowSeconds(options.windowMs),
      p_max_requests: options.maxRequests,
    });

    if (error) {
      throw new Error(error.message);
    }

    const row = toSharedRow(data);
    if (!row) {
      throw new Error("Rate limit RPC returned malformed payload.");
    }

    const resetAtMs = Number.isFinite(Date.parse(row.reset_at))
      ? Date.parse(row.reset_at)
      : nowMs + options.windowMs;

    return {
      allowed: row.allowed,
      remaining: Math.max(0, Math.floor(row.remaining)),
      retryAfterSeconds: Math.max(0, Math.ceil(row.retry_after_seconds)),
      resetAtMs,
      source: "supabase",
    };
  } catch (error) {
    if (shouldLogFallbackWarning()) {
      console.warn(
        "[shared-rate-limit] fallback",
        JSON.stringify({
          scope: normalizedScope,
          reason: error instanceof Error ? error.message : String(error),
          inMemoryDisabled: isInMemoryFallbackDisabled(),
        }),
      );
    }

    return toFallbackResult(normalizedKey, options, nowMs);
  }
}
