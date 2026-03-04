# Security Best Practices Report

Date: 2026-03-04

## Executive Summary

Security review and remediation were completed for XSS, SQL injection, admin mutation protection, service-role secret exposure, and baseline hardening controls.

Current state:

- Critical findings: none
- High findings: none
- Medium findings: 1 residual operational item
- Low findings: none

The previous three identified issues were remediated in code:

1. Admin origin allowlist hardening (fixed)
2. Cross-instance rate-limit architecture (fixed in code + migration added)
3. CSP `script-src 'unsafe-inline'` (fixed with nonce-based proxy CSP)

## Findings

### CRIT / HIGH

None identified.

### MED-001: Shared rate-limit migration must be applied in deployed Supabase project

- Severity: Medium
- Location:
  - Migration file: `supabase/migrations/20260304174500_phase4_shared_public_rate_limit.sql`
  - Runtime helper fallback path: `src/lib/rate-limit/shared.ts`
  - Public routes: `src/app/api/components/[id]/download/route.ts`, `src/app/api/components/[id]/liquid/route.ts`
- Evidence:
  - Public routes now call RPC `public.consume_public_rate_limit(...)`.
  - If the RPC is not present yet, helper logs fallback and uses local in-memory limiter.
- Impact:
  - Until migration is applied in the active database, limits remain per-instance fallback behavior.
- Fix:
  - Apply migrations in the target Supabase project so RPC/table exists.
- Mitigation:
  - Keep upstream edge/gateway throttling enabled until migration rollout is complete.

## Remediation Evidence (Completed)

### 1) Admin origin allowlist hardening

- Updated `src/lib/security/admin-request-guard.ts`:
  - Production uses strict configured origins (`APP_ORIGIN`, optional `ADMIN_ALLOWED_ORIGINS`)
  - Host/proto fallback is development-only
  - Production fails closed when no origins configured
- Updated tests: `test/admin-request-guard.test.mjs`

### 2) Shared rate limiting

- Added helper: `src/lib/rate-limit/shared.ts`
- Integrated into:
  - `src/app/api/components/[id]/download/route.ts`
  - `src/app/api/components/[id]/liquid/route.ts`
- Added migration:
  - `supabase/migrations/20260304174500_phase4_shared_public_rate_limit.sql`
  - Adds `public.public_rate_limits`
  - Adds `public.consume_public_rate_limit(...)` security-definer RPC
  - Grants execute to `anon`, `authenticated`

### 3) CSP script hardening

- Added nonce-based CSP proxy: `src/proxy.ts`
  - Sets per-request nonce via `x-nonce`
  - Enforces `Content-Security-Policy` with nonce-based `script-src`
  - `script-src` no longer includes `'unsafe-inline'`
- Removed static CSP emission from `next.config.ts` to avoid policy conflicts

### 4) Service-role secret boundary hardening

- Added server-only guards:
  - `src/lib/supabase/service-role.ts`
  - `src/lib/supabase/signed-storage-url.ts`
- Docs/env updates:
  - `.env.example` (`ADMIN_ALLOWED_ORIGINS`)
  - `README.md` (service-role usage scope and signed URL behavior)
- Secret exposure checks:
  - Service-role key not present in `.next/static` client bundle
  - Service-role key value not present in repository files outside `.env.local`

## SQL Injection / XSS Status

- SQL injection:
  - App routes use Supabase query builder (`.eq`, `.ilike`, `.insert`, `.delete`) rather than string SQL construction.
  - No SQL-string concatenation sinks found in reviewed app route paths.
- XSS:
  - `dangerouslySetInnerHTML` usage is limited to JSON-LD scripts with serializer escaping `<` (`src/lib/seo/site.ts`).
  - CSP now nonce-based for scripts (defense in depth).

## Verification Performed

- `pnpm lint`: pass
- `pnpm typecheck`: pass
- `pnpm test`: pass
- `pnpm build`: pass
- `pnpm test:e2e -- e2e/admin.spec.ts e2e/public-gallery.spec.ts`: pass (11/11)
- `pnpm audit --prod`: pass (`No known vulnerabilities found`)

