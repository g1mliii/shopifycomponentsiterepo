-- Make Data API grants explicit for Supabase's opt-in public schema exposure.
-- Existing projects previously received broad default grants; future projects do not.

grant select
  on table public.shopify_components
  to anon, authenticated;

grant insert, update, delete
  on table public.shopify_components
  to authenticated;

grant select, insert, update, delete
  on table public.shopify_components
  to service_role;

grant select
  on table public.admin_users
  to authenticated;

grant select, insert, update, delete
  on table public.admin_users
  to service_role;

grant select, insert, update, delete
  on table public.public_rate_limits
  to service_role;

revoke all on function public.set_updated_at() from public;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin()
  to authenticated, service_role;

grant execute on function public.component_rows_with_missing_storage(integer)
  to service_role;

grant execute on function public.component_storage_orphans(integer)
  to service_role;

grant execute on function public.consume_public_rate_limit(text, text, integer, integer)
  to anon, authenticated;

grant execute on function public.list_public_components_batch(integer, integer, text, text)
  to anon, authenticated;
