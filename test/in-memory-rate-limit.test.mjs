import test from "node:test";
import assert from "node:assert/strict";

import {
  clearInMemoryRateLimitForTests,
  consumeInMemoryRateLimit,
} from "../src/lib/rate-limit/in-memory.ts";

test.beforeEach(() => {
  clearInMemoryRateLimitForTests();
});

test("consumeInMemoryRateLimit allows until limit and blocks after", () => {
  const nowMs = 1_000;

  const first = consumeInMemoryRateLimit(
    "ip-1",
    { windowMs: 60_000, maxRequests: 2, maxEntries: 100 },
    nowMs,
  );
  const second = consumeInMemoryRateLimit(
    "ip-1",
    { windowMs: 60_000, maxRequests: 2, maxEntries: 100 },
    nowMs + 5,
  );
  const third = consumeInMemoryRateLimit(
    "ip-1",
    { windowMs: 60_000, maxRequests: 2, maxEntries: 100 },
    nowMs + 10,
  );

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.ok(third.retryAfterSeconds >= 1);
});

test("consumeInMemoryRateLimit resets after window", () => {
  const options = { windowMs: 1_000, maxRequests: 1, maxEntries: 100 };

  consumeInMemoryRateLimit("ip-2", options, 1_000);
  const blocked = consumeInMemoryRateLimit("ip-2", options, 1_100);
  const allowedAgain = consumeInMemoryRateLimit("ip-2", options, 2_001);

  assert.equal(blocked.allowed, false);
  assert.equal(allowedAgain.allowed, true);
});

test("consumeInMemoryRateLimit prunes old entries when maxEntries exceeded", () => {
  const options = { windowMs: 60_000, maxRequests: 1, maxEntries: 2 };

  consumeInMemoryRateLimit("ip-a", options, 1_000);
  consumeInMemoryRateLimit("ip-b", options, 1_010);
  consumeInMemoryRateLimit("ip-c", options, 1_020);

  const shouldAllowIfPruned = consumeInMemoryRateLimit("ip-a", options, 1_030);
  assert.equal(shouldAllowIfPruned.allowed, true);
});

test("consumeInMemoryRateLimit keeps recently touched keys when maxEntries exceeded", () => {
  const options = { windowMs: 60_000, maxRequests: 2, maxEntries: 2 };

  consumeInMemoryRateLimit("ip-a", options, 1_000);
  consumeInMemoryRateLimit("ip-b", options, 1_010);
  consumeInMemoryRateLimit("ip-a", options, 1_020);
  consumeInMemoryRateLimit("ip-c", options, 1_030);

  const ipAThirdHit = consumeInMemoryRateLimit("ip-a", options, 1_040);
  const ipBFirstHitAgain = consumeInMemoryRateLimit("ip-b", options, 1_050);

  assert.equal(ipAThirdHit.allowed, false);
  assert.equal(ipBFirstHitAgain.allowed, true);
});
