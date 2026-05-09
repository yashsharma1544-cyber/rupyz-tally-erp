-- ============================================================================
-- 19 — Truck-trip aggregator for the /trucks page.
--
-- Groups dispatches by (vehicle_number, driver_name, dispatch date), counts
-- delivered stops, counts how many of those have GPS captured. Used to
-- show "View route" buttons for completed truck trips.
--
-- Most-recent trips first.
-- ============================================================================

drop function if exists truck_trips(date, date);

create or replace function truck_trips(
  date_from date default (current_date - interval '30 days')::date,
  date_to   date default current_date
)
returns table (
  vehicle_number   text,
  driver_name      text,
  driver_user_id   uuid,
  trip_date        date,
  dispatch_count   bigint,
  delivered_count  bigint,
  with_gps_count   bigint,
  total_qty        numeric,
  total_amount     numeric,
  earliest_at      timestamptz,
  latest_at        timestamptz
)
language sql
stable
as $$
  select
    coalesce(d.vehicle_number, '')                  as vehicle_number,
    coalesce(d.driver_name, '')                     as driver_name,
    (array_agg(d.driver_user_id) filter (where d.driver_user_id is not null))[1] as driver_user_id,
    (coalesce(d.shipped_at, d.created_at)::date)    as trip_date,
    count(*)::bigint                                as dispatch_count,
    count(*) filter (where d.status = 'delivered')::bigint as delivered_count,
    count(*) filter (
      where d.status = 'delivered'
        and p.latitude is not null
        and p.longitude is not null
    )::bigint                                       as with_gps_count,
    coalesce(sum(d.total_qty), 0)::numeric          as total_qty,
    coalesce(sum(d.total_amount), 0)::numeric       as total_amount,
    min(coalesce(d.shipped_at, d.created_at))       as earliest_at,
    max(coalesce(p.captured_at, d.shipped_at, d.created_at)) as latest_at
  from dispatches d
  left join pods p on p.dispatch_id = d.id
  where coalesce(d.shipped_at, d.created_at)::date between date_from and date_to
    and d.status in ('shipped', 'delivered')
  group by d.vehicle_number, d.driver_name, (coalesce(d.shipped_at, d.created_at)::date)
  having count(*) > 0
  order by max(coalesce(p.captured_at, d.shipped_at, d.created_at)) desc;
$$;

grant execute on function truck_trips(date, date) to authenticated;

-- Quick test:
--   select * from truck_trips();
