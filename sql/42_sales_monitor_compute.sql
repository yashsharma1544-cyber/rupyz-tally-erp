-- 42_sales_monitor_compute.sql
-- Continuous & Efficient Sale — Phase 2 compute layer
--
-- Two RPCs:
--   sales_monitor_summary(p_date)            — table per active salesman, summary numbers for admin grid
--   sales_monitor_status(p_salesman_id, p_date) — full JSONB for a single salesman including focus customer lists
--
-- Kg formula: sum(qty * coalesce(packaging_size, 1)) filtered on packaging_unit ILIKE 'kg'.
-- If your data uses a different convention we can swap this in one place.
--
-- Timezone: orders.rupyz_created_at is UTC. We convert to Asia/Kolkata and take the date.

-- ---------------------------------------------------------------------------
-- 1. sales_monitor_summary(p_date)
-- ---------------------------------------------------------------------------
create or replace function sales_monitor_summary(p_date date)
returns table (
  salesman_id      uuid,
  salesman_name    text,
  salesman_phone   text,
  beat_id          uuid,
  beat_name        text,
  beat_city        text,
  sc               int,
  target_kg        numeric,
  calls_done       int,
  kg_done          numeric,
  checked_in_at    timestamptz
)
language sql stable as $$
  select
    s.id                                                            as salesman_id,
    s.name                                                          as salesman_name,
    s.phone                                                         as salesman_phone,
    sba.beat_id,
    b.name                                                          as beat_name,
    b.city                                                          as beat_city,
    (select count(*)::int from customers c
       where c.beat_id = sba.beat_id and c.active = true)           as sc,
    dst.target_kg,
    coalesce((
      select count(distinct o.customer_id)::int from orders o
       where o.salesman_id = s.id
         and (o.rupyz_created_at at time zone 'Asia/Kolkata')::date = p_date
    ), 0)                                                           as calls_done,
    coalesce((
      select sum(coalesce(oi.qty, 0) * coalesce(oi.packaging_size, 1))
        from order_items oi
        join orders o on o.id = oi.order_id
       where o.salesman_id = s.id
         and (o.rupyz_created_at at time zone 'Asia/Kolkata')::date = p_date
         and coalesce(oi.packaging_unit, '') ilike 'kg'
    ), 0)                                                           as kg_done,
    dsc.checked_in_at
  from salesmen s
  left join salesman_beat_assignments sba
    on sba.salesman_id = s.id and sba.assignment_date = p_date
  left join beats b
    on b.id = sba.beat_id
  left join daily_sales_targets dst
    on dst.salesman_id = s.id and dst.target_date = p_date
  left join daily_sales_checkins dsc
    on dsc.salesman_id = s.id and dsc.checkin_date = p_date
  where s.active = true
  order by s.name;
$$;

grant execute on function sales_monitor_summary(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. sales_monitor_status(p_salesman_id, p_date) — JSONB with focus lists
-- ---------------------------------------------------------------------------
create or replace function sales_monitor_status(p_salesman_id uuid, p_date date)
returns jsonb
language plpgsql stable as $$
declare
  v_salesman          record;
  v_beat              record;
  v_sc                int := 0;
  v_target_kg         numeric;
  v_calls_done        int := 0;
  v_kg_done           numeric := 0;
  v_checked_in_at     timestamptz;
  v_last_beat_date    date;
  v_focus_last_visit  jsonb := '[]'::jsonb;
  v_focus_15_days     jsonb := '[]'::jsonb;
begin
  -- Salesman record
  select id, name, phone into v_salesman
  from salesmen
  where id = p_salesman_id;

  if v_salesman.id is null then
    return jsonb_build_object('error', 'salesman_not_found');
  end if;

  -- Beat assignment for the day
  select b.id, b.name, b.city into v_beat
  from salesman_beat_assignments sba
  join beats b on b.id = sba.beat_id
  where sba.salesman_id = p_salesman_id
    and sba.assignment_date = p_date;

  -- Always-available numbers (regardless of beat)
  select target_kg into v_target_kg
  from daily_sales_targets
  where salesman_id = p_salesman_id and target_date = p_date;

  select coalesce(count(distinct customer_id)::int, 0) into v_calls_done
  from orders
  where salesman_id = p_salesman_id
    and (rupyz_created_at at time zone 'Asia/Kolkata')::date = p_date;

  select coalesce(sum(coalesce(oi.qty, 0) * coalesce(oi.packaging_size, 1)), 0)
  into v_kg_done
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.salesman_id = p_salesman_id
    and (o.rupyz_created_at at time zone 'Asia/Kolkata')::date = p_date
    and coalesce(oi.packaging_unit, '') ilike 'kg';

  select checked_in_at into v_checked_in_at
  from daily_sales_checkins
  where salesman_id = p_salesman_id and checkin_date = p_date;

  -- Beat-dependent: SC count + focus customer lists
  if v_beat.id is not null then
    select count(*)::int into v_sc
    from customers
    where beat_id = v_beat.id and active = true;

    -- Last day this salesman covered this beat
    select max(assignment_date) into v_last_beat_date
    from salesman_beat_assignments
    where salesman_id = p_salesman_id
      and beat_id = v_beat.id
      and assignment_date < p_date;

    -- Focus (a): customers on beat with NO order from this salesman on the last beat day
    if v_last_beat_date is not null then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id',     c.id,
            'name',   c.name,
            'mobile', c.mobile,
            'city',   c.city
          ) order by c.name
        ),
        '[]'::jsonb
      )
      into v_focus_last_visit
      from customers c
      where c.beat_id = v_beat.id
        and c.active = true
        and not exists (
          select 1 from orders o
          where o.customer_id = c.id
            and o.salesman_id = p_salesman_id
            and (o.rupyz_created_at at time zone 'Asia/Kolkata')::date = v_last_beat_date
        );
    end if;

    -- Focus (b): customers on beat with no order from anyone in last 15 days
    with last_order as (
      select o.customer_id, max((o.rupyz_created_at at time zone 'Asia/Kolkata')::date) as last_date
      from orders o
      where o.customer_id in (select id from customers where beat_id = v_beat.id and active = true)
      group by o.customer_id
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',                    c.id,
          'name',                  c.name,
          'mobile',                c.mobile,
          'city',                  c.city,
          'last_order_date',       lo.last_date,
          'days_since_last_order', case when lo.last_date is null then null
                                        else (p_date - lo.last_date)::int end
        ) order by lo.last_date nulls first, c.name
      ),
      '[]'::jsonb
    )
    into v_focus_15_days
    from customers c
    left join last_order lo on lo.customer_id = c.id
    where c.beat_id = v_beat.id
      and c.active = true
      and (lo.last_date is null or lo.last_date < (p_date - interval '15 days'));
  end if;

  return jsonb_build_object(
    'salesman_id',                p_salesman_id,
    'salesman_name',              v_salesman.name,
    'salesman_phone',             v_salesman.phone,
    'date',                       p_date,
    'has_assignment',             v_beat.id is not null,
    'beat_id',                    v_beat.id,
    'beat_name',                  v_beat.name,
    'beat_city',                  v_beat.city,
    'sc',                         v_sc,
    'target_kg',                  v_target_kg,
    'calls_done',                 v_calls_done,
    'kg_done',                    v_kg_done,
    'checked_in_at',              v_checked_in_at,
    'last_beat_date',             v_last_beat_date,
    'focus_no_order_last_visit',  v_focus_last_visit,
    'focus_no_order_in_15_days',  v_focus_15_days
  );
end;
$$;

grant execute on function sales_monitor_status(uuid, date) to authenticated;
