-- ============================================================================
-- 09 — Extend orders_kpis_by_status to accept an optional beat_id filter.
-- Old callers continue to work (beat_id_filter defaults to null).
--
-- Why DROP first: PostgreSQL doesn't allow CREATE OR REPLACE FUNCTION to
-- change the parameter list. A new optional param counts as a new signature.
-- ============================================================================

drop function if exists orders_kpis_by_status(timestamptz);
drop function if exists orders_kpis_by_status(timestamptz, uuid);

create or replace function orders_kpis_by_status(
  since_ts        timestamptz default null,
  beat_id_filter  uuid        default null
)
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
    count(*)::bigint                                  as order_count,
    coalesce(sum(ow.kg), 0)::numeric(14, 3)           as total_kg,
    coalesce(sum(o.total_amount), 0)::numeric(14, 2)  as total_amount
  from orders o
  left join order_weights ow on ow.order_id = o.id
  left join customers c     on c.id        = o.customer_id
  where (since_ts is null or o.rupyz_created_at >= since_ts)
    and (beat_id_filter is null or c.beat_id = beat_id_filter)
  group by o.app_status;
$$;

grant execute on function orders_kpis_by_status(timestamptz, uuid) to authenticated;

-- Quick test:
--   select * from orders_kpis_by_status();
--   select * from orders_kpis_by_status(now() - interval '7 days');
--   select * from orders_kpis_by_status(null, '<beat-uuid>');
