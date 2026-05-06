-- ============================================================================
-- 14 — KPI RPC for the dispatch app's beat tiles
--
-- Returns one row per beat that has at least one approved (or partly
-- dispatched) order, with order_count, total_kg, total_amount.
--
-- Beats with zero pending dispatch work are excluded.
-- ============================================================================

drop function if exists dispatch_kpis_by_beat();

create or replace function dispatch_kpis_by_beat()
returns table (
  beat_id      uuid,
  beat_name    text,
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
    b.id                                                  as beat_id,
    b.name                                                as beat_name,
    count(o.id)::bigint                                   as order_count,
    coalesce(sum(ow.kg), 0)::numeric(14, 3)               as total_kg,
    coalesce(sum(o.total_amount), 0)::numeric(14, 2)      as total_amount
  from orders o
  join customers c on c.id = o.customer_id
  join beats b     on b.id = c.beat_id
  left join order_weights ow on ow.order_id = o.id
  where o.app_status in ('approved', 'partially_dispatched')
  group by b.id, b.name
  having count(o.id) > 0
  order by b.name;
$$;

grant execute on function dispatch_kpis_by_beat() to authenticated;

-- Quick test:
--   select * from dispatch_kpis_by_beat();
