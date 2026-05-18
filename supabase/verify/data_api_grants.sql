-- Supabase Data API grant audit.
-- Run in the Supabase SQL Editor. The first three sections should return zero rows.

-- 1. Expected table grants missing from the live database.
with expected_grants(schema_name, relation_name, role_name, privilege_name) as (
  values
    ('public', 'shopify_components', 'anon', 'SELECT'),
    ('public', 'shopify_components', 'authenticated', 'SELECT'),
    ('public', 'shopify_components', 'authenticated', 'INSERT'),
    ('public', 'shopify_components', 'authenticated', 'UPDATE'),
    ('public', 'shopify_components', 'authenticated', 'DELETE'),
    ('public', 'shopify_components', 'service_role', 'SELECT'),
    ('public', 'shopify_components', 'service_role', 'INSERT'),
    ('public', 'shopify_components', 'service_role', 'UPDATE'),
    ('public', 'shopify_components', 'service_role', 'DELETE'),
    ('public', 'admin_users', 'authenticated', 'SELECT'),
    ('public', 'admin_users', 'service_role', 'SELECT'),
    ('public', 'admin_users', 'service_role', 'INSERT'),
    ('public', 'admin_users', 'service_role', 'UPDATE'),
    ('public', 'admin_users', 'service_role', 'DELETE'),
    ('public', 'public_rate_limits', 'service_role', 'SELECT'),
    ('public', 'public_rate_limits', 'service_role', 'INSERT'),
    ('public', 'public_rate_limits', 'service_role', 'UPDATE'),
    ('public', 'public_rate_limits', 'service_role', 'DELETE')
),
resolved_grants as (
  select
    *,
    to_regclass(format('%I.%I', schema_name, relation_name)) as relation_oid
  from expected_grants
)
select *
from resolved_grants
where relation_oid is null
   or case
    when relation_oid is null then false
    else has_table_privilege(role_name, relation_oid, privilege_name)
  end is not true
order by schema_name, relation_name, role_name, privilege_name;

-- 2. Expected RPC/helper function grants missing from the live database.
with expected_function_grants(role_name, function_identity) as (
  values
    ('authenticated', 'public.is_admin()'),
    ('service_role', 'public.is_admin()'),
    ('service_role', 'public.component_rows_with_missing_storage(integer)'),
    ('service_role', 'public.component_storage_orphans(integer)'),
    ('anon', 'public.consume_public_rate_limit(text, text, integer, integer)'),
    ('authenticated', 'public.consume_public_rate_limit(text, text, integer, integer)'),
    ('anon', 'public.list_public_components_batch(integer, integer, text, text)'),
    ('authenticated', 'public.list_public_components_batch(integer, integer, text, text)')
),
resolved_function_grants as (
  select
    *,
    to_regprocedure(function_identity) as function_oid
  from expected_function_grants
)
select *
from resolved_function_grants
where function_oid is null
   or case
    when function_oid is null then false
    else has_function_privilege(role_name, function_oid, 'EXECUTE')
  end is not true
order by function_identity, role_name;

-- 3. Expected RLS coverage missing from Data API-facing tables.
with expected_rls(schema_name, relation_name) as (
  values
    ('public', 'shopify_components'),
    ('public', 'admin_users')
)
select
  expected_rls.schema_name,
  expected_rls.relation_name,
  pg_class.relrowsecurity as rls_enabled
from expected_rls
left join pg_class
  on pg_class.oid = to_regclass(format('%I.%I', schema_name, relation_name))
where pg_class.oid is null
   or pg_class.relrowsecurity is not true
order by expected_rls.schema_name, expected_rls.relation_name;

-- 4. Inventory all public tables and current Data API role privileges.
select
  table_schema,
  table_name,
  has_table_privilege('anon', format('%I.%I', table_schema, table_name), 'SELECT') as anon_select,
  has_table_privilege('authenticated', format('%I.%I', table_schema, table_name), 'SELECT') as authenticated_select,
  has_table_privilege('authenticated', format('%I.%I', table_schema, table_name), 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', format('%I.%I', table_schema, table_name), 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', format('%I.%I', table_schema, table_name), 'DELETE') as authenticated_delete,
  has_table_privilege('service_role', format('%I.%I', table_schema, table_name), 'SELECT') as service_role_select,
  has_table_privilege('service_role', format('%I.%I', table_schema, table_name), 'INSERT') as service_role_insert,
  has_table_privilege('service_role', format('%I.%I', table_schema, table_name), 'UPDATE') as service_role_update,
  has_table_privilege('service_role', format('%I.%I', table_schema, table_name), 'DELETE') as service_role_delete
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_schema, table_name;

-- 5. Current default privilege rows for future objects in public.
select
  defaclrole::regrole as grantor_role,
  defaclnamespace::regnamespace as schema_name,
  defaclobjtype as object_type,
  defaclacl as default_acl
from pg_default_acl
where defaclnamespace = 'public'::regnamespace
order by defaclrole::regrole::text, defaclobjtype;
