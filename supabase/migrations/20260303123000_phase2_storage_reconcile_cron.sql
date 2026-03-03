-- Phase 2: storage reconciliation safety net
-- This migration adds SQL helpers and an hourly cron schedule that calls the
-- component-storage-reconcile Edge Function.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.component_rows_with_missing_storage(p_limit integer default 100)
returns table (
  id uuid,
  thumbnail_path text,
  file_path text,
  missing_thumbnail boolean,
  missing_file boolean
)
language sql
security definer
set search_path = public, storage
as $$
  with normalized as (
    select greatest(1, least(coalesce(p_limit, 100), 500)) as lim
  )
  select
    component.id,
    component.thumbnail_path,
    component.file_path,
    thumbnail_obj.id is null as missing_thumbnail,
    liquid_obj.id is null as missing_file
  from public.shopify_components as component
  left join storage.objects as thumbnail_obj
    on thumbnail_obj.bucket_id = 'component-thumbnails'
   and thumbnail_obj.name = component.thumbnail_path
  left join storage.objects as liquid_obj
    on liquid_obj.bucket_id = 'liquid-files'
   and liquid_obj.name = component.file_path
  where thumbnail_obj.id is null
     or liquid_obj.id is null
  order by component.created_at asc
  limit (select lim from normalized);
$$;

revoke all on function public.component_rows_with_missing_storage(integer) from public;
grant execute on function public.component_rows_with_missing_storage(integer) to service_role;

create or replace function public.component_storage_orphans(p_limit integer default 200)
returns table (
  bucket_id text,
  object_name text
)
language sql
security definer
set search_path = public, storage
as $$
  with normalized as (
    select greatest(1, least(coalesce(p_limit, 200), 1000)) as lim
  )
  select
    object_row.bucket_id,
    object_row.name as object_name
  from storage.objects as object_row
  where object_row.bucket_id in ('component-thumbnails', 'liquid-files')
    and (
      (
        object_row.bucket_id = 'component-thumbnails'
        and not exists (
          select 1
          from public.shopify_components as component
          where component.thumbnail_path = object_row.name
        )
      )
      or
      (
        object_row.bucket_id = 'liquid-files'
        and not exists (
          select 1
          from public.shopify_components as component
          where component.file_path = object_row.name
        )
      )
    )
  order by object_row.created_at asc
  limit (select lim from normalized);
$$;

revoke all on function public.component_storage_orphans(integer) from public;
grant execute on function public.component_storage_orphans(integer) to service_role;

select
  cron.schedule(
    'component-storage-reconcile-hourly',
    '17 * * * *',
    $$
    select
      net.http_post(
        url:= (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
          || '/functions/v1/component-storage-reconcile',
        headers:= jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body:= jsonb_build_object(
          'source', 'pg_cron',
          'scheduled_at', now()
        ),
        timeout_milliseconds:= 15000
      ) as request_id;
    $$
  );
