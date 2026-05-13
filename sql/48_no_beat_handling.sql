-- ============================================================================
-- 48 — dispatch_kpis_by_beat: Jalna filter + no-beat handling
--
-- Two fixes in one:
-- 1. Jalna filter (was lost in a previous deploy — restored)
-- 2. No-beat row: customers without beat_id assigned get grouped under
--    a synthetic UUID '00000000-0000-0000-0000-000000000000' with
--    beat_name 'No beat assigned'. The /dispatch UI handles this UUID
--    as a special route that fetches no-beat orders.
-- ============================================================================

create or replace function dispatch_kpis_by_beat()
returns table (
  beat_id uuid,
  beat_name text,
  order_count bigint,
  total_kg numeric,
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
  ),
  -- Real beats (customers WITH beat assignment)
  real_beats as (
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
    where o.app_status in ('approved', 'partially_dispatched', 'loaded')
      and (
        lower(trim(coalesce(b.city, ''))) = 'jalna'
        or lower(trim(coalesce(c.city, ''))) = 'jalna'
      )
    group by b.id, b.name
    having count(o.id) > 0
  ),
  -- Synthetic "No beat" row (customers WITHOUT beat assignment, Jalna only)
  no_beat as (
    select
      '00000000-0000-0000-0000-000000000000'::uuid          as beat_id,
      'No beat assigned'                                    as beat_name,
      count(o.id)::bigint                                   as order_count,
      coalesce(sum(ow.kg), 0)::numeric(14, 3)               as total_kg,
      coalesce(sum(o.total_amount), 0)::numeric(14, 2)      as total_amount
    from orders o
    join customers c on c.id = o.customer_id
    left join order_weights ow on ow.order_id = o.id
    where o.app_status in ('approved', 'partially_dispatched', 'loaded')
      and c.beat_id is null
      and lower(trim(coalesce(c.city, ''))) = 'jalna'
    having count(o.id) > 0
  )
  select * from real_beats
  union all
  select * from no_beat
  order by 
    -- Sort "No beat" to the top so admin sees it first
    case when beat_id = '00000000-0000-0000-0000-000000000000'::uuid then 0 else 1 end,
    beat_name;
$$;

grant execute on function dispatch_kpis_by_beat() to authenticated;
