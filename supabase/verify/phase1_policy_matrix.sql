-- Phase 1 policy matrix verification
-- This script is designed to fail hard on any unexpected policy behavior.

begin;

-- Stable fixture identifiers for deterministic policy checks.
-- The transaction is rolled back at the end so no fixture data is persisted.
delete from public.shopify_components
where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
delete from public.admin_users
where user_id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);
delete from auth.users
where id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);

insert into auth.users (id)
values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');

insert into public.admin_users (user_id)
values ('00000000-0000-0000-0000-000000000001');

-- Admin can insert component rows.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
insert into public.shopify_components (
  id, title, category, thumbnail_path, file_path
)
values (
  '11111111-1111-1111-1111-111111111111',
  'Admin Inserted Component',
  'hero',
  'phase1/thumbnail.png',
  'phase1/component.liquid'
);

-- Anon can read shopify_components.
reset role;
set local role anon;
do $$
declare
  visible_count integer;
begin
  select count(*)
  into visible_count
  from public.shopify_components
  where id = '11111111-1111-1111-1111-111111111111';

  if visible_count <> 1 then
    raise exception 'anon read failed: expected 1 visible row, got %', visible_count;
  end if;
end
$$;

-- Authenticated non-admin cannot insert/update/delete component rows.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

do $$
begin
  begin
    insert into public.shopify_components (
      id, title, category, thumbnail_path, file_path
    )
    values (
      '22222222-2222-2222-2222-222222222222',
      'Non Admin Insert',
      'hero',
      'phase1/non-admin-thumb.png',
      'phase1/non-admin-file.liquid'
    );
    raise exception 'non-admin insert unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

do $$
begin
  update public.shopify_components
  set title = 'Non Admin Updated'
  where id = '11111111-1111-1111-1111-111111111111';

  if found then
    raise exception 'non-admin update unexpectedly affected rows';
  end;
end
$$;

do $$
begin
  delete from public.shopify_components
  where id = '11111111-1111-1111-1111-111111111111';

  if found then
    raise exception 'non-admin delete unexpectedly affected rows';
  end;
end
$$;

-- Admin can update/delete component rows.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

update public.shopify_components
set title = 'Admin Updated Component'
where id = '11111111-1111-1111-1111-111111111111';

do $$
declare
  updated_title text;
begin
  select title
  into updated_title
  from public.shopify_components
  where id = '11111111-1111-1111-1111-111111111111';

  if updated_title <> 'Admin Updated Component' then
    raise exception 'admin update failed: expected title to be Admin Updated Component, got %', updated_title;
  end if;
end
$$;

-- Reinsert after delete so read checks remain deterministic.
delete from public.shopify_components
where id = '11111111-1111-1111-1111-111111111111';

insert into public.shopify_components (
  id, title, category, thumbnail_path, file_path
)
values (
  '11111111-1111-1111-1111-111111111111',
  'Admin Reinserted Component',
  'hero',
  'phase1/thumbnail.png',
  'phase1/component.liquid'
);

-- admin_users self-read only.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
declare
  own_rows integer;
begin
  select count(*)
  into own_rows
  from public.admin_users
  where user_id = '00000000-0000-0000-0000-000000000001';

  if own_rows <> 1 then
    raise exception 'admin self-read failed: expected 1 row, got %', own_rows;
  end if;
end
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1
    from public.admin_users
    where user_id = '00000000-0000-0000-0000-000000000001';

    if found then
      raise exception 'anon admin_users read unexpectedly returned rows';
    end if;
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
declare
  non_admin_rows integer;
begin
  select count(*)
  into non_admin_rows
  from public.admin_users
  where user_id = '00000000-0000-0000-0000-000000000001';

  if non_admin_rows <> 0 then
    raise exception 'non-admin arbitrary admin_users read failed: expected 0 rows, got %', non_admin_rows;
  end if;
end
$$;

-- Storage policy checks.
-- Admin can upload objects.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
insert into storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
values (
  'component-thumbnails',
  'phase1-policy/admin-thumb.png',
  '00000000-0000-0000-0000-000000000001',
  '{}'::jsonb,
  '{}'::jsonb,
  '1'
);
insert into storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
values (
  'liquid-files',
  'phase1-policy/admin-file.liquid',
  '00000000-0000-0000-0000-000000000001',
  '{}'::jsonb,
  '{}'::jsonb,
  '1'
);

do $$
begin
  update storage.objects
  set user_metadata = '{"updated_by":"admin"}'::jsonb
  where bucket_id = 'component-thumbnails'
    and name = 'phase1-policy/admin-thumb.png';

  if not found then
    raise exception 'admin storage update failed for component-thumbnails';
  end if;
end
$$;

do $$
begin
  update storage.objects
  set user_metadata = '{"updated_by":"admin"}'::jsonb
  where bucket_id = 'liquid-files'
    and name = 'phase1-policy/admin-file.liquid';

  if not found then
    raise exception 'admin storage update failed for liquid-files';
  end if;
end
$$;

-- Non-admin cannot upload storage objects.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata, user_metadata, version)
    values (
      'component-thumbnails',
      'phase1-policy/non-admin-thumb.png',
      '00000000-0000-0000-0000-000000000002',
      '{}'::jsonb,
      '{}'::jsonb,
      '1'
    );
    raise exception 'non-admin storage insert unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end
$$;

do $$
begin
  update storage.objects
  set user_metadata = '{"updated_by":"non_admin"}'::jsonb
  where bucket_id = 'component-thumbnails'
    and name = 'phase1-policy/admin-thumb.png';

  if found then
    raise exception 'non-admin storage update unexpectedly affected component-thumbnails';
  end if;
end
$$;

do $$
begin
  update storage.objects
  set user_metadata = '{"updated_by":"non_admin"}'::jsonb
  where bucket_id = 'liquid-files'
    and name = 'phase1-policy/admin-file.liquid';

  if found then
    raise exception 'non-admin storage update unexpectedly affected liquid-files';
  end if;
end
$$;

-- Anon can read public thumbnail object metadata.
reset role;
set local role anon;
do $$
declare
  thumb_rows integer;
begin
  select count(*)
  into thumb_rows
  from storage.objects
  where bucket_id = 'component-thumbnails'
    and name = 'phase1-policy/admin-thumb.png';

  if thumb_rows <> 1 then
    raise exception 'anon thumbnail metadata read failed: expected 1 row, got %', thumb_rows;
  end if;
end
$$;

-- Anon cannot read private liquid object metadata.
do $$
declare
  liquid_rows integer;
begin
  select count(*)
  into liquid_rows
  from storage.objects
  where bucket_id = 'liquid-files'
    and name = 'phase1-policy/admin-file.liquid';

  if liquid_rows <> 0 then
    raise exception 'anon liquid metadata read failed: expected 0 rows, got %', liquid_rows;
  end if;
end
$$;

reset role;
select 'phase1_policy_matrix_passed' as result;

rollback;
