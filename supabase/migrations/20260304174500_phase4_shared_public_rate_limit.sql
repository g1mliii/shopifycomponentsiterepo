-- Phase 4 hardening: shared, cross-instance public route rate limiting.
-- This replaces per-instance in-memory-only limits with a centralized
-- Postgres-backed window counter callable from anon/authenticated roles.

create table if not exists public.public_rate_limits (
  scope text not null,
  subject_key text not null,
  request_count integer not null check (request_count >= 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (scope, subject_key)
);

create index if not exists public_rate_limits_updated_at_idx
  on public.public_rate_limits (updated_at);

revoke all on table public.public_rate_limits from anon, authenticated;

create or replace function public.consume_public_rate_limit(
  p_scope text,
  p_key text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_utc timestamptz := timezone('utc', now());
  normalized_scope text;
  normalized_key text;
  next_count integer;
  next_reset_at timestamptz;
begin
  normalized_scope := left(trim(coalesce(p_scope, '')), 64);
  normalized_key := left(trim(coalesce(p_key, '')), 256);

  if normalized_scope = '' then
    raise exception 'p_scope must be non-empty';
  end if;

  if normalized_key = '' then
    raise exception 'p_key must be non-empty';
  end if;

  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'p_window_seconds must be >= 1';
  end if;

  if p_max_requests is null or p_max_requests < 1 then
    raise exception 'p_max_requests must be >= 1';
  end if;

  insert into public.public_rate_limits as rate_limits (
    scope,
    subject_key,
    request_count,
    reset_at,
    updated_at
  )
  values (
    normalized_scope,
    normalized_key,
    1,
    now_utc + make_interval(secs => p_window_seconds),
    now_utc
  )
  on conflict (scope, subject_key) do update
  set
    request_count = case
      when rate_limits.reset_at <= now_utc then 1
      else rate_limits.request_count + 1
    end,
    reset_at = case
      when rate_limits.reset_at <= now_utc then now_utc + make_interval(secs => p_window_seconds)
      else rate_limits.reset_at
    end,
    updated_at = now_utc
  returning request_count, reset_at
  into next_count, next_reset_at;

  if random() < 0.01 then
    delete from public.public_rate_limits
    where updated_at < now_utc - interval '24 hours';
  end if;

  allowed := next_count <= p_max_requests;
  remaining := greatest(p_max_requests - next_count, 0);
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (next_reset_at - now_utc)))::integer)
  end;
  reset_at := next_reset_at;

  return next;
end;
$$;

revoke all on function public.consume_public_rate_limit(text, text, integer, integer) from public;
grant execute on function public.consume_public_rate_limit(text, text, integer, integer)
  to anon, authenticated;
