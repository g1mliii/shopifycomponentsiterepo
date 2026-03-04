import assert from "node:assert/strict";
import test from "node:test";

import { guardAdminMutationRequest } from "../src/lib/security/admin-request-guard.ts";

function createAdminMutationRequest(headers = {}) {
  return new Request("https://app.example.com/api/admin/components", {
    method: "POST",
    headers,
  });
}

test("guardAdminMutationRequest rejects when CSRF header is missing", () => {
  const result = guardAdminMutationRequest(
    createAdminMutationRequest({
      origin: "https://app.example.com",
      host: "app.example.com",
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_csrf");
  assert.equal(result.status, 403);
});

test("guardAdminMutationRequest rejects when origin is missing", () => {
  const result = guardAdminMutationRequest(
    createAdminMutationRequest({
      host: "app.example.com",
      "x-admin-csrf": "1",
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_origin");
  assert.equal(result.status, 403);
});

test("guardAdminMutationRequest rejects mismatched origin", () => {
  const result = guardAdminMutationRequest(
    createAdminMutationRequest({
      origin: "https://evil.example.com",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
      "x-admin-csrf": "1",
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_origin");
  assert.equal(result.status, 403);
});

test("guardAdminMutationRequest accepts same-origin mutation with CSRF header", () => {
  const result = guardAdminMutationRequest(
    createAdminMutationRequest({
      origin: "https://app.example.com",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
      "x-admin-csrf": "1",
    }),
  );

  assert.deepEqual(result, { ok: true });
});
