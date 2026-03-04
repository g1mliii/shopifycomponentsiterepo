# PressPlay Shopify Components

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
- `SUPABASE_SERVICE_ROLE_KEY` is a secret and must only be used in trusted server code (never client components, never browser).

### Production Hosting

- Do not use `.env.local` in hosted environments. Configure environment variables in your hosting platform (for example Vercel project settings).
- Client-side app access should use only `NEXT_PUBLIC_SUPABASE_URL` + publishable/anon key and rely on RLS + authenticated user JWT.
- Use `SUPABASE_SERVICE_ROLE_KEY` only for privileged server-side jobs (for example admin bootstrap, secure maintenance scripts, or protected server routes/functions).

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
