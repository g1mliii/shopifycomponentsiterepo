-- Phase 1: Components schema, admin auth model, RLS policies, and storage controls

create table if not exists public.shopify_components (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  category text not null check (char_length(trim(category)) > 0),
  thumbnail_path text not null check (char_length(trim(thumbnail_path)) > 0),
  file_path text not null check (char_length(trim(file_path)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopify_components_created_at_idx
  on public.shopify_components (created_at desc);

create index if not exists shopify_components_category_idx
  on public.shopify_components (category);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_shopify_components_updated_at on public.shopify_components;
create trigger set_shopify_components_updated_at
before update on public.shopify_components
for each row
execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

alter table public.shopify_components enable row level security;
alter table public.admin_users enable row level security;

revoke all on table public.shopify_components from anon, authenticated;
grant select on table public.shopify_components to anon, authenticated;
grant insert, update, delete on table public.shopify_components to authenticated;

revoke all on table public.admin_users from anon, authenticated;
grant select on table public.admin_users to authenticated;

drop policy if exists shopify_components_public_read on public.shopify_components;
create policy shopify_components_public_read
on public.shopify_components
for select
to anon, authenticated
using (true);

drop policy if exists shopify_components_admin_insert on public.shopify_components;
create policy shopify_components_admin_insert
on public.shopify_components
for insert
to authenticated
with check ((select public.is_admin()));

drop policy if exists shopify_components_admin_update on public.shopify_components;
create policy shopify_components_admin_update
on public.shopify_components
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists shopify_components_admin_delete on public.shopify_components;
create policy shopify_components_admin_delete
on public.shopify_components
for delete
to authenticated
using ((select public.is_admin()));

drop policy if exists admin_users_self_read on public.admin_users;
create policy admin_users_self_read
on public.admin_users
for select
to authenticated
using (user_id = (select auth.uid()));

insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types)
values (
  'component-thumbnails',
  'component-thumbnails',
  true,
  26214400,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm']
)
on conflict (id) do update
set
  name = excluded.name,
  "public" = excluded."public",
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types)
values (
  'liquid-files',
  'liquid-files',
  false,
  2097152,
  array['text/plain', 'text/x-liquid', 'application/octet-stream']
)
on conflict (id) do update
set
  name = excluded.name,
  "public" = excluded."public",
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

drop policy if exists storage_component_thumbnails_public_read on storage.objects;
create policy storage_component_thumbnails_public_read
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'component-thumbnails');

drop policy if exists storage_component_thumbnails_admin_insert on storage.objects;
create policy storage_component_thumbnails_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'component-thumbnails'
  and (select public.is_admin())
);

drop policy if exists storage_component_thumbnails_admin_update on storage.objects;
create policy storage_component_thumbnails_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'component-thumbnails'
  and (select public.is_admin())
)
with check (
  bucket_id = 'component-thumbnails'
  and (select public.is_admin())
);

drop policy if exists storage_component_thumbnails_admin_delete on storage.objects;
create policy storage_component_thumbnails_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'component-thumbnails'
  and (select public.is_admin())
);

drop policy if exists storage_liquid_files_admin_select on storage.objects;
create policy storage_liquid_files_admin_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'liquid-files'
  and (select public.is_admin())
);

drop policy if exists storage_liquid_files_admin_insert on storage.objects;
create policy storage_liquid_files_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'liquid-files'
  and (select public.is_admin())
);

drop policy if exists storage_liquid_files_admin_update on storage.objects;
create policy storage_liquid_files_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'liquid-files'
  and (select public.is_admin())
)
with check (
  bucket_id = 'liquid-files'
  and (select public.is_admin())
);

drop policy if exists storage_liquid_files_admin_delete on storage.objects;
create policy storage_liquid_files_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'liquid-files'
  and (select public.is_admin())
);
