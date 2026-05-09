-- ============================================================================
-- 20 — RPC: drivers currently active (loading or en-route).
--
-- Returns one row per driver who has at least one dispatch in 'pending' or
-- 'shipped' status. Used by the "Drivers active now" panel on /dispatches.
-- ============================================================================

drop function if exists drivers_active_now();

create or replace function drivers_active_now()
returns table (
  driver_user_id  uuid,
  driver_name     text,
  driver_phone    text,
  loading_count   bigint,
  shipped_count   bigint,
  vehicle_numbers text[],
  total_amount    numeric,
  oldest_at       timestamptz
)
language sql
stable
as $$
  select
    u.id                                                    as driver_user_id,
    coalesce(u.full_name, '')                               as driver_name,
    coalesce(u.phone, '')                                   as driver_phone,
    count(*) filter (where d.status = 'pending')::bigint    as loading_count,
    count(*) filter (where d.status = 'shipped')::bigint    as shipped_count,
    array_agg(distinct d.vehicle_number) filter (where d.vehicle_number is not null and d.vehicle_number <> '') as vehicle_numbers,
    coalesce(sum(d.total_amount), 0)::numeric               as total_amount,
    min(d.created_at)                                       as oldest_at
  from dispatches d
  join app_users u on u.id = d.driver_user_id
  where d.status in ('pending', 'shipped')
    and u.role = 'driver'
  group by u.id, u.full_name, u.phone
  order by min(d.created_at);
$$;

grant execute on function drivers_active_now() to authenticated;

-- Quick test:
--   select * from drivers_active_now();
