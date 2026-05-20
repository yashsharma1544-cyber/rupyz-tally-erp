-- =============================================================================
-- 54_distribution_365d.sql
--
-- 1. Creates area_distribution_365d() — same as area_distribution_84d but with
--    a 365-day window AND the corrected 4-branch kg logic (the old version only
--    counted packaging_unit ILIKE 'kg', dropping items sold by unit='Kg' or by
--    gram weight — same bug we fixed in the sales monitor RPCs).
-- 2. Drops the duplicate target system built in migration 53
--    (beat_targets, customer_targets, beat_customer_shares) — superseded by the
--    existing area_jc_targets / beat_jc_targets / customer_jc_targets flow.
--
-- Column names use _365d suffix (renamed from _84d) for clarity.
-- =============================================================================

create or replace function public.area_distribution_365d(p_area_id uuid)
returns table(
  beat_id          uuid,
  beat_name        text,
  beat_kg_365d     numeric,
  customer_id      uuid,
  customer_name    text,
  customer_kg_365d numeric
)
language sql
stable
as $function$
  with beat_kg as (
    select c.beat_id,
      sum(
        case
          when lower(coalesce(oi.unit,'')) = 'kg' then coalesce(oi.qty,0)
          when lower(coalesce(oi.unit,'')) in ('g','gm') or lower(coalesce(oi.unit,'')) like 'gram%' then coalesce(oi.qty,0)/1000.0
          when lower(coalesce(oi.packaging_unit,'')) = 'kg' then coalesce(oi.qty,0)*coalesce(oi.packaging_size,0)
          when lower(coalesce(oi.packaging_unit,'')) in ('g','gm') or lower(coalesce(oi.packaging_unit,'')) like 'gram%' then (coalesce(oi.qty,0)*coalesce(oi.packaging_size,0))/1000.0
          else 0
        end
      ) as kg
    from customers c
    join orders      o  on o.customer_id = c.id
    join order_items oi on oi.order_id   = o.id
    where o.rupyz_created_at >= now() - interval '365 days'
    group by c.beat_id
  ),
  cust_kg as (
    select o.customer_id,
      sum(
        case
          when lower(coalesce(oi.unit,'')) = 'kg' then coalesce(oi.qty,0)
          when lower(coalesce(oi.unit,'')) in ('g','gm') or lower(coalesce(oi.unit,'')) like 'gram%' then coalesce(oi.qty,0)/1000.0
          when lower(coalesce(oi.packaging_unit,'')) = 'kg' then coalesce(oi.qty,0)*coalesce(oi.packaging_size,0)
          when lower(coalesce(oi.packaging_unit,'')) in ('g','gm') or lower(coalesce(oi.packaging_unit,'')) like 'gram%' then (coalesce(oi.qty,0)*coalesce(oi.packaging_size,0))/1000.0
          else 0
        end
      ) as kg
    from orders      o
    join order_items oi on oi.order_id = o.id
    where o.rupyz_created_at >= now() - interval '365 days'
    group by o.customer_id
  )
  select
    b.id   as beat_id,
    b.name as beat_name,
    coalesce(bk.kg, 0)::numeric as beat_kg_365d,
    c.id   as customer_id,
    c.name as customer_name,
    coalesce(ck.kg, 0)::numeric as customer_kg_365d
  from beats b
  left join customers c  on c.beat_id      = b.id
  left join beat_kg   bk on bk.beat_id     = b.id
  left join cust_kg   ck on ck.customer_id = c.id
  where b.area_id = p_area_id
  order by b.name, c.name;
$function$;

grant execute on function public.area_distribution_365d(uuid) to authenticated;

-- ---- Drop the duplicate target system from migration 53 --------------------
drop function if exists public.beat_customer_shares(uuid, int);
drop table if exists public.customer_targets;
drop table if exists public.beat_targets;

-- ---- Verify ----------------------------------------------------------------
-- Pick an area and confirm beats + customers come back with 365-day kg:
-- select * from area_distribution_365d('PUT-AN-AREA-ID') limit 20;
