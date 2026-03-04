import assert from "node:assert/strict";
import test from "node:test";

import { guardAdminMutationRequest } from "../src/lib/security/admin-request-guard.ts";

const originalAppOrigin = process.env.APP_ORIGIN;
const originalAdditionalOrigins = process.env.ADMIN_ALLOWED_ORIGINS;
const originalNodeEnv = process.env.NODE_ENV;

function createAdminMutationRequest(headers = {}) {
  return new Request("https://app.example.com/api/admin/components", {
    method: "POST",
    headers,
  });
}

test.beforeEach(() => {
  process.env.NODE_ENV = "production";
  process.env.APP_ORIGIN = "https://app.example.com";
  delete process.env.ADMIN_ALLOWED_ORIGINS;
});

test.after(() => {
  if (typeof originalAppOrigin === "string") {
    process.env.APP_ORIGIN = originalAppOrigin;
  } else {
    delete process.env.APP_ORIGIN;
  }

  if (typeof originalAdditionalOrigins === "string") {
    process.env.ADMIN_ALLOWED_ORIGINS = originalAdditionalOrigins;
  } else {
    delete process.env.ADMIN_ALLOWED_ORIGINS;
  }

  if (typeof originalNodeEnv === "string") {
    process.env.NODE_ENV = originalNodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }
});

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
      "x-admin-csrf": "1",
    }),
  );

  assert.deepEqual(result, { ok: true });
});

test("guardAdminMutationRequest allows explicit additional origins", () => {
  process.env.ADMIN_ALLOWED_ORIGINS = "https://ops.example.com, https://admin.example.com";
  const result = guardAdminMutationRequest(
    createAdminMutationRequest({
      origin: "https://admin.example.com",
      "x-admin-csrf": "1",
    }),
  );

  assert.deepEqual(result, { ok: true });
});

test("guardAdminMutationRequest fails closed in production when no origins are configured", () => {
  delete process.env.APP_ORIGIN;
  delete process.env.ADMIN_ALLOWED_ORIGINS;
  const result = guardAdminMutationRequest(
    createAdminMutationRequest({
      origin: "https://app.example.com",
      "x-admin-csrf": "1",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "origin_not_configured");
  assert.equal(result.status, 500);
});

test("guardAdminMutationRequest allows host-derived fallback only in development", () => {
  process.env.NODE_ENV = "development";
  delete process.env.APP_ORIGIN;
  delete process.env.ADMIN_ALLOWED_ORIGINS;
  const result = guardAdminMutationRequest(
    createAdminMutationRequest({
      origin: "https://app.example.com",
      "x-admin-csrf": "1",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
    }),
  );

  assert.deepEqual(result, { ok: true });
});
