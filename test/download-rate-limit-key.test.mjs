import assert from "node:assert/strict";
import test from "node:test";

import { getDownloadRateLimitKey } from "../src/lib/rate-limit/download-key.ts";

test.beforeEach(() => {
  delete process.env.TRUST_PROXY_X_REAL_IP;
  delete process.env.TRUST_PROXY_X_FORWARDED_FOR;
});

test.after(() => {
  delete process.env.TRUST_PROXY_X_REAL_IP;
  delete process.env.TRUST_PROXY_X_FORWARDED_FOR;
});

test("getDownloadRateLimitKey prefers trusted provider IP headers", () => {
  const request = new Request("https://example.test/api/components/id/download", {
    headers: {
      "cf-connecting-ip": "203.0.113.42",
      "user-agent": "UnitTestAgent/1.0",
    },
  });

  const key = getDownloadRateLimitKey(request);
  assert.equal(key, "ip:203.0.113.42");
});

test("getDownloadRateLimitKey does not trust x-forwarded-for by default", () => {
  const request = new Request("https://example.test/api/components/id/download", {
    headers: {
      "x-forwarded-for": "198.51.100.10",
      "user-agent": "UnitTestAgent/1.0",
    },
  });

  const key = getDownloadRateLimitKey(request);
  assert.equal(key, "fp:unittestagent/1.0|");
});

test("getDownloadRateLimitKey does not trust x-real-ip by default", () => {
  const request = new Request("https://example.test/api/components/id/download", {
    headers: {
      "x-real-ip": "198.51.100.10",
      "user-agent": "UnitTestAgent/1.0",
    },
  });

  const key = getDownloadRateLimitKey(request);
  assert.equal(key, "fp:unittestagent/1.0|");
});

test("getDownloadRateLimitKey can trust x-real-ip when explicitly enabled", () => {
  process.env.TRUST_PROXY_X_REAL_IP = "true";

  const request = new Request("https://example.test/api/components/id/download", {
    headers: {
      "x-real-ip": "198.51.100.10",
    },
  });

  const key = getDownloadRateLimitKey(request);
  assert.equal(key, "ip:198.51.100.10");
});

test("getDownloadRateLimitKey can trust x-forwarded-for when explicitly enabled", () => {
  process.env.TRUST_PROXY_X_FORWARDED_FOR = "true";

  const request = new Request("https://example.test/api/components/id/download", {
    headers: {
      "x-forwarded-for": "198.51.100.10, 198.51.100.11",
    },
  });

  const key = getDownloadRateLimitKey(request);
  assert.equal(key, "ip:198.51.100.10");
});

test("getDownloadRateLimitKey falls back to reduced fingerprint when IP headers are invalid", () => {
  const request = new Request("https://example.test/api/components/id/download", {
    headers: {
      "x-real-ip": "invalid ip value",
      "user-agent": "Gallery Browser",
      "accept-language": "en-CA,en;q=0.9",
    },
  });

  const key = getDownloadRateLimitKey(request);
  assert.equal(key, "fp:gallery browser|en-ca,en;q=0.9");
});
