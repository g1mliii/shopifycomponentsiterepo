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
- `SUPABASE_SERVICE_ROLE_KEY` is a secret and must only be used in trusted server code (never client components, never browser).

### Production Hosting

- Do not use `.env.local` in hosted environments. Configure environment variables in your hosting platform (for example Vercel project settings).
- Client-side app access should use only `NEXT_PUBLIC_SUPABASE_URL` + publishable/anon key and rely on RLS + authenticated user JWT.
- Use `SUPABASE_SERVICE_ROLE_KEY` only for privileged server-side jobs (for example admin bootstrap, secure maintenance scripts, or protected server routes/functions).

## Baseline Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```
