-- Phase 4 hardening: prevent global public reads of liquid-files.
-- Public customer downloads continue through short-lived signed URLs
-- minted by trusted server routes.

update storage.buckets
set
  "public" = false,
  updated_at = now()
where id = 'liquid-files';

drop policy if exists storage_liquid_files_public_read on storage.objects;
