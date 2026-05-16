-- =============================================================================
-- 40_orders_kpis_by_status_with_until.sql
--
-- Adds an `until_ts` parameter to orders_kpis_by_status so the Orders KPI
-- cards can support a true date range (start AND end), not just "since".
--
-- Behavior of the new param:
--   until_ts IS NULL  -> no upper bound (matches the old behavior exactly)
--   until_ts NOT NULL -> only rows where rupyz_created_at < until_ts
--
-- `until_ts` is intentionally exclusive (< not <=). The client passes
-- "start of next day" as the upper bound so the range covers the full
-- selected end date through 23:59:59.999 without flaky millisecond math.
--
-- Existing callers that only pass since_ts + beat_id_filter continue to
-- work unchanged because until_ts defaults to NULL.
-- =============================================================================

drop function if exists public.orders_kpis_by_status(timestamp with time zone, uuid);

create or replace function public.orders_kpis_by_status(
  since_ts       timestamp with time zone default null,
  beat_id_filter uuid                     default null,
  until_ts       timestamp with time zone default null
)
returns table(
  app_status   text,
  order_count  bigint,
  total_kg     numeric,
  total_amount numeric
)
language sql
stable
as $function$
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
  where (since_ts       is null or o.rupyz_created_at >= since_ts)
    and (until_ts       is null or o.rupyz_created_at <  until_ts)
    and (beat_id_filter is null or c.beat_id          =  beat_id_filter)
  group by o.app_status;
$function$;

grant execute on function public.orders_kpis_by_status(
  timestamp with time zone, uuid, timestamp with time zone
) to authenticated;
