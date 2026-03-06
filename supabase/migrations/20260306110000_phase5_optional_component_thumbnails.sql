-- Phase 5: allow components to be created before a thumbnail exists.
-- Admins can upload or replace the thumbnail later from the admin panel.

alter table public.shopify_components
  alter column thumbnail_path drop not null;

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
    component.thumbnail_path is not null and thumbnail_obj.id is null as missing_thumbnail,
    liquid_obj.id is null as missing_file
  from public.shopify_components as component
  left join storage.objects as thumbnail_obj
    on component.thumbnail_path is not null
   and thumbnail_obj.bucket_id = 'component-thumbnails'
   and thumbnail_obj.name = component.thumbnail_path
  left join storage.objects as liquid_obj
    on liquid_obj.bucket_id = 'liquid-files'
   and liquid_obj.name = component.file_path
  where (component.thumbnail_path is not null and thumbnail_obj.id is null)
     or liquid_obj.id is null
  order by component.created_at asc
  limit (select lim from normalized);
$$;
