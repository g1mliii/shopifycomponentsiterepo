# Shopify Components

Baseline repository for a Shopify Liquid component gallery built with Next.js, TypeScript, Tailwind, and Supabase.

## Prerequisites

- Node.js 22.x LTS
- pnpm 10+

## Quickstart

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://127.0.0.1:3000`.

## Supabase Setup (MCP)

This repo uses Supabase MCP project setup instead of `supabase login` / `supabase link`.

1. Authenticate the Supabase MCP server with your Supabase access token.
2. Create a project via MCP.
3. Fill `.env.local` with values from that project:
   - `SUPABASE_PROJECT_REF`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Update `supabase/config.toml` `project_id` with your project ref.

### Environment Variable Safety

- `NEXT_PUBLIC_*` variables are exposed to the browser bundle.
- `APP_ORIGIN` should be set to your production origin (for example `https://your-domain.com`) to harden admin mutation origin checks.
- `ADMIN_ALLOWED_ORIGINS` is optional and supports a comma-separated trusted origin allowlist for admin mutation requests.
- `SUPABASE_SERVICE_ROLE_KEY` is a secret and must only be used in trusted server code (never client components, never browser).

### Production Hosting

- Do not use `.env.local` in hosted environments. Configure environment variables in your hosting platform (for example Vercel project settings).
- Client-side app access should use only `NEXT_PUBLIC_SUPABASE_URL` + publishable/anon key and rely on RLS + authenticated user JWT.
- Use `SUPABASE_SERVICE_ROLE_KEY` only for privileged server-side jobs (for example admin bootstrap, secure maintenance scripts, or protected server routes/functions).
- Public download/liquid endpoints in this repo mint short-lived signed URLs server-side for private `liquid-files`; this requires service-role usage on the server boundary only.

### Firebase App Hosting

This repo includes Firebase App Hosting config files:

- `.firebaserc`
- `firebase.json`
- `apphosting.yaml`

Current default Firebase project:

- `shopifycomponents-030426`

Important:

- Firebase App Hosting requires the project to be on the Blaze plan before backend creation/deploy can succeed.
- After enabling Blaze, create/deploy backend with:
  - `firebase apphosting:backends:create --backend shopifycomponents --primary-region us-central1 --app <WEB_APP_ID> --root-dir .`
  - `firebase deploy --only apphosting --project shopifycomponents-030426`

Cost-focused defaults in `apphosting.yaml`:

- `minInstances: 0` and `maxInstances: 1` to cap idle and burst spend.
- `cpu: 1`, `memoryMiB: 512`, `concurrency: 80` for low baseline runtime cost.
- `DISABLE_PUBLIC_COMPONENTS_CACHE=true` to avoid long-lived in-memory result caches on server instances.
- `DISABLE_RATE_LIMIT_FALLBACK_IN_MEMORY=true` for zero in-memory fallback state.
- `ENABLE_SHARED_RATE_LIMIT_FALLBACK_LOGS=false` to reduce noisy fallback logs/cost.
- This assumes `supabase/migrations/20260304191500_phase4_shared_public_rate_limit_fix.sql` is already applied so shared RPC remains healthy.

Storage/browser caching behavior:

- Gallery thumbnails are served directly from Supabase public storage URLs and can be cached by browser/CDN.
- Downloaded Liquid files are delivered via short-lived signed URLs; caching is handled by the storage response and browser, not by server in-memory buffers.

## Storage Reconciliation Cron

This project includes a daily reconciliation safety net for storage drift:

- Edge Function: `component-storage-reconcile`
- Cron job: `component-storage-reconcile-daily` (runs once per day at `00:17 UTC`)
- SQL helpers:
  - `public.component_rows_with_missing_storage(p_limit integer default 100)`
  - `public.component_storage_orphans(p_limit integer default 200)`

The cron job invokes the Edge Function via `pg_net`, with secrets read from Supabase Vault:

- `project_url`
- `service_role_key`

If these Vault secrets are missing in a new environment, create them before relying on cron execution.

## Baseline Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```
