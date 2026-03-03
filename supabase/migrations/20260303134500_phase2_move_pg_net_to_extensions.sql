-- Security remediation: re-create pg_net extension outside of public schema.
-- pg_net does not support ALTER EXTENSION ... SET SCHEMA.
-- This resolves Security Advisor lint: extension_in_public_pg_net.

create schema if not exists extensions;

do $$
declare
  current_schema text;
  queued_requests bigint;
begin
  select n.nspname
  into current_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net';

  if current_schema is null then
    create extension pg_net schema extensions;
    return;
  end if;

  if current_schema = 'extensions' then
    return;
  end if;

  select count(*)
  into queued_requests
  from net.http_request_queue;

  if queued_requests > 0 then
    raise exception 'cannot re-create pg_net while net.http_request_queue is non-empty (% pending)', queued_requests;
  end if;

  drop extension pg_net;
  create extension pg_net schema extensions;
end
$$;
