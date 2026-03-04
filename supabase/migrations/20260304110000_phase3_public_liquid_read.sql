-- Phase 3: make liquid files publicly readable while preserving admin-only writes.

update storage.buckets
set
  "public" = true,
  updated_at = now()
where id = 'liquid-files';

drop policy if exists storage_liquid_files_public_read on storage.objects;
create policy storage_liquid_files_public_read
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'liquid-files');
