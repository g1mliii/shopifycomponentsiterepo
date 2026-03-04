-- Phase 4 cost optimization: batch public component listing metadata in one RPC.
-- Reduces per-request PostgREST round trips for gallery list + category filters.

create or replace function public.list_public_components_batch(
  p_page integer,
  p_limit integer,
  p_query text default null,
  p_category text default null
)
returns table (
  components jsonb,
  total bigint,
  categories text[]
)
language sql
security invoker
set search_path = public, pg_temp
as $$
with normalized as (
  select
    greatest(coalesce(p_page, 1), 1) as page_number,
    greatest(least(coalesce(p_limit, 24), 100), 1) as page_limit,
    nullif(trim(coalesce(p_query, '')), '') as title_query,
    nullif(trim(lower(coalesce(p_category, ''))), '') as category_filter
),
escaped_query as (
  select
    n.page_number,
    n.page_limit,
    n.category_filter,
    case
      when n.title_query is null then null
      else replace(
        replace(
          replace(n.title_query, '\', '\\'),
          '%',
          '\%'
        ),
        '_',
        '\_'
      )
    end as title_query
  from normalized n
),
filtered as (
  select
    sc.id,
    sc.title,
    sc.category,
    sc.thumbnail_path,
    sc.created_at
  from public.shopify_components sc
  cross join escaped_query q
  where
    (q.title_query is null or sc.title ilike '%' || q.title_query || '%' escape '\')
    and (q.category_filter is null or sc.category = q.category_filter)
),
pagination_bounds as (
  select
    ((q.page_number - 1) * q.page_limit) + 1 as row_start,
    q.page_number * q.page_limit as row_end
  from escaped_query q
),
numbered as (
  select
    f.id,
    f.title,
    f.category,
    f.thumbnail_path,
    f.created_at,
    row_number() over (order by f.created_at desc, f.id desc) as row_num
  from filtered f
),
paged as (
  select
    n.id,
    n.title,
    n.category,
    n.thumbnail_path,
    n.created_at
  from numbered n
  cross join pagination_bounds pb
  where n.row_num between pb.row_start and pb.row_end
  order by n.row_num
),
total_count as (
  select count(*)::bigint as value
  from filtered
),
distinct_categories as (
  select distinct lower(trim(sc.category)) as category
  from public.shopify_components sc
  where sc.category is not null
    and trim(sc.category) <> ''
),
category_list as (
  select coalesce(array_agg(dc.category order by dc.category), '{}'::text[]) as value
  from distinct_categories dc
)
select
  coalesce(
    (
      select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc)
      from paged p
    ),
    '[]'::jsonb
  ) as components,
  total_count.value as total,
  category_list.value as categories
from total_count
cross join category_list;
$$;

revoke all on function public.list_public_components_batch(integer, integer, text, text) from public;
grant execute on function public.list_public_components_batch(integer, integer, text, text)
  to anon, authenticated;
