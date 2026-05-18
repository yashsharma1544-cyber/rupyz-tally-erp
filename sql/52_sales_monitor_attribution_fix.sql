-- =============================================================================
-- 52_sales_monitor_attribution_fix.sql
--
-- Fixes two bugs in sales_monitor_summary + sales_monitor_status:
--
-- BUG 1: Orders with NULL orders.salesman_id (most Rupyz orders) were never
--        attributed to any salesman. Fix: fall back to "today's beat owner"
--        via customers.beat_id → salesman_beat_assignments. Direct attribution
--        still wins when present.
--
-- BUG 2: kg_done only counted items where packaging_unit ILIKE 'kg', silently
--        dropping items sold by unit='kg' (with whatever packaging) and items
--        sold by gram weight. Now uses the same 4-branch logic as
--        pipeline_stage_summary: unit=kg → qty; unit=g → qty/1000;
--        else packaging_unit=kg → qty*size; else packaging_unit=g → qty*size/1000.
--
-- Also simplifies focus_no_order_last_visit: instead of "this salesman didn't
-- visit", it's now "no one visited", matching focus_no_order_in_15_days. This
-- is what you actually want for focus lists — a customer who ordered from
-- anyone shouldn't be flagged as a missed call.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sales_monitor_summary(p_date date)
 RETURNS TABLE(
   salesman_id     uuid,
   salesman_name   text,
   salesman_phone  text,
   beat_id         uuid,
   beat_name       text,
   beat_city       text,
   sc              integer,
   target_kg       numeric,
   calls_done      integer,
   kg_done         numeric,
   checked_in_at   timestamp with time zone
 )
 LANGUAGE sql
 STABLE
AS $function$
  select
    s.id          as salesman_id,
    s.name        as salesman_name,
    s.phone       as salesman_phone,
    sba.beat_id,
    b.name        as beat_name,
    b.city        as beat_city,
    (select count(*)::int from customers c
       where c.beat_id = sba.beat_id and c.active = true) as sc,
    dst.target_kg,
    -- calls_done: direct salesman_id match OR (NULL fallback to today's beat owner)
    coalesce((
      select count(distinct o.customer_id)::int
      from orders o
      left join customers c on c.id = o.customer_id
      where (o.rupyz_created_at at time zone 'Asia/Kolkata')::date = p_date
        and (
          o.salesman_id = s.id
          or (
            o.salesman_id is null
            and sba.beat_id is not null
            and c.beat_id = sba.beat_id
          )
        )
    ), 0) as calls_done,
    -- kg_done: same attribution + four-branch unit logic
    coalesce((
      select sum(
        case
          when lower(coalesce(oi.unit, '')) = 'kg'
            then coalesce(oi.qty, 0)
          when lower(coalesce(oi.unit, '')) in ('g', 'gm')
            or lower(coalesce(oi.unit, '')) like 'gram%'
            then coalesce(oi.qty, 0) / 1000.0
          when lower(coalesce(oi.packaging_unit, '')) = 'kg'
            then coalesce(oi.qty, 0) * coalesce(oi.packaging_size, 0)
          when lower(coalesce(oi.packaging_unit, '')) in ('g', 'gm')
            or lower(coalesce(oi.packaging_unit, '')) like 'gram%'
            then (coalesce(oi.qty, 0) * coalesce(oi.packaging_size, 0)) / 1000.0
          else 0
        end
      )
      from order_items oi
      join orders o on o.id = oi.order_id
      left join customers c on c.id = o.customer_id
      where (o.rupyz_created_at at time zone 'Asia/Kolkata')::date = p_date
        and (
          o.salesman_id = s.id
          or (
            o.salesman_id is null
            and sba.beat_id is not null
            and c.beat_id = sba.beat_id
          )
        )
    ), 0)::numeric as kg_done,
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
$function$;

grant execute on function public.sales_monitor_summary(date) to authenticated;


CREATE OR REPLACE FUNCTION public.sales_monitor_status(p_salesman_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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

  -- Target
  select target_kg into v_target_kg
  from daily_sales_targets
  where salesman_id = p_salesman_id and target_date = p_date;

  -- calls_done: direct attribution + beat-based fallback for NULL salesman_id orders
  select coalesce(count(distinct o.customer_id)::int, 0)
  into v_calls_done
  from orders o
  left join customers c on c.id = o.customer_id
  where (o.rupyz_created_at at time zone 'Asia/Kolkata')::date = p_date
    and (
      o.salesman_id = p_salesman_id
      or (
        o.salesman_id is null
        and v_beat.id is not null
        and c.beat_id = v_beat.id
      )
    );

  -- kg_done: same attribution + four-branch unit logic
  select coalesce(sum(
    case
      when lower(coalesce(oi.unit, '')) = 'kg'
        then coalesce(oi.qty, 0)
      when lower(coalesce(oi.unit, '')) in ('g', 'gm')
        or lower(coalesce(oi.unit, '')) like 'gram%'
        then coalesce(oi.qty, 0) / 1000.0
      when lower(coalesce(oi.packaging_unit, '')) = 'kg'
        then coalesce(oi.qty, 0) * coalesce(oi.packaging_size, 0)
      when lower(coalesce(oi.packaging_unit, '')) in ('g', 'gm')
        or lower(coalesce(oi.packaging_unit, '')) like 'gram%'
        then (coalesce(oi.qty, 0) * coalesce(oi.packaging_size, 0)) / 1000.0
      else 0
    end
  ), 0)
  into v_kg_done
  from order_items oi
  join orders o on o.id = oi.order_id
  left join customers c on c.id = o.customer_id
  where (o.rupyz_created_at at time zone 'Asia/Kolkata')::date = p_date
    and (
      o.salesman_id = p_salesman_id
      or (
        o.salesman_id is null
        and v_beat.id is not null
        and c.beat_id = v_beat.id
      )
    );

  -- Check-in
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

    -- Focus (a): customers on beat with no order from ANYONE on the last beat day.
    -- (Previously required this specific salesman's salesman_id, which broke with
    -- NULL-salesman orders. The new logic asks "was this customer reached at all".)
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
$function$;

grant execute on function public.sales_monitor_status(uuid, date) to authenticated;


-- =============================================================================
-- Verification: re-run summary and confirm the D Raja salesmen + Raju now show
-- credible call counts and kg numbers. Three salesmen on D Raja will all
-- show the same totals (since they share the beat) — that's the intended
-- behavior under "multiple salesmen per beat" rules.
-- =============================================================================
select * from sales_monitor_summary(current_date);
