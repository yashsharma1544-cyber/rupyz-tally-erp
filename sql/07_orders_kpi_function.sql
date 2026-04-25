-- ============================================================================
-- orders_kpis_by_status(since_ts) — aggregates by app_status:
--   order_count, total_kg, total_amount
--
-- Kg conversion logic per line item:
--   • unit = kg          → qty
--   • unit = g/gm/gram   → qty / 1000
--   • packaging_unit=kg  → qty × packaging_size           (e.g., box of 5kg)
--   • packaging_unit=g   → qty × packaging_size / 1000    (e.g., pkt of 250g)
--   • else               → 0 (unknown units don't count)
-- ============================================================================

create or replace function orders_kpis_by_status(since_ts timestamptz default null)
returns table (
  app_status   text,
  order_count  bigint,
  total_kg     numeric,
  total_amount numeric
)
language sql
stable
as $$
  with order_weights as (
    select
      oi.order_id,
      sum(
        case
          when oi.unit ilike 'kg'                                   then oi.qty
          when oi.unit ilike 'g' or oi.unit ilike 'gm'
            or oi.unit ilike 'gram%'                                then oi.qty / 1000.0
          when oi.packaging_unit ilike 'kg'                         then oi.qty * coalesce(oi.packaging_size, 0)
          when oi.packaging_unit ilike 'g' or oi.packaging_unit ilike 'gm'
            or oi.packaging_unit ilike 'gram%'                      then oi.qty * coalesce(oi.packaging_size, 0) / 1000.0
          else 0
        end
      ) as kg
    from order_items oi
    group by oi.order_id
  )
  select
    o.app_status::text,
    count(*)::bigint                            as order_count,
    coalesce(sum(ow.kg), 0)::numeric(14, 3)     as total_kg,
    coalesce(sum(o.total_amount), 0)::numeric(14, 2) as total_amount
  from orders o
  left join order_weights ow on ow.order_id = o.id
  where since_ts is null or o.rupyz_created_at >= since_ts
  group by o.app_status;
$$;

-- Allow authenticated users to call it (RLS still applies to underlying tables)
grant execute on function orders_kpis_by_status(timestamptz) to authenticated;

-- Quick test:
--   select * from orders_kpis_by_status();                              -- all time
--   select * from orders_kpis_by_status(now() - interval '7 days');     -- last 7 days
