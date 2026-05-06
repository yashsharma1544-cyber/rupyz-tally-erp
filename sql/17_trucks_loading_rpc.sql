-- ============================================================================
-- 17 — RPC for the dispatch PWA's "Trucks loading" view.
--
-- Groups currently-pending dispatches by vehicle + driver. One row per
-- vehicle+driver combo. The dispatcher uses this to mark a whole truck as
-- "dispatched (truck left)" in one tap.
-- ============================================================================

drop function if exists trucks_loading();

create or replace function trucks_loading()
returns table (
  vehicle_number text,
  driver_name    text,
  driver_phone   text,
  dispatch_count bigint,
  order_count    bigint,
  total_qty      numeric,
  total_amount   numeric,
  oldest_loaded_at timestamptz,
  dispatch_ids   uuid[]
)
language sql
stable
as $$
  select
    coalesce(d.vehicle_number, '')                  as vehicle_number,
    coalesce(d.driver_name, '')                     as driver_name,
    coalesce(max(d.driver_phone), '')               as driver_phone,
    count(*)::bigint                                as dispatch_count,
    count(distinct d.order_id)::bigint              as order_count,
    coalesce(sum(d.total_qty), 0)::numeric          as total_qty,
    coalesce(sum(d.total_amount), 0)::numeric       as total_amount,
    min(d.created_at)                               as oldest_loaded_at,
    array_agg(d.id)                                 as dispatch_ids
  from dispatches d
  where d.status = 'pending'
  group by d.vehicle_number, d.driver_name
  order by min(d.created_at);
$$;

grant execute on function trucks_loading() to authenticated;

-- Quick test:
--   select * from trucks_loading();
