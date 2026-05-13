-- ============================================================================
-- 28 — Customer detail RPC
--
-- Returns everything the customer detail page needs in ONE call:
--   - Basic customer info (name, beat, phone, etc.)
--   - Recency: last order date, last visit date, days since each
--   - kg this 30d / prev 30d / 90d / lifetime
--   - growth_pct (this 30d vs prev 30d)
--   - order count, avg basket kg, avg gap days
--   - product mix (top 6 products by kg in last 90d)
--   - last 10 orders
--   - confidence flag: how reliable are the numbers?
--
-- Designed for: scoped access. Caller passes their auth.uid(); the function
-- verifies the user can see this customer.
-- ============================================================================

create or replace function customer_detail(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer record;
  v_allowed boolean;
  v_kg_30d numeric;
  v_kg_prev_30d numeric;
  v_kg_90d numeric;
  v_kg_lifetime numeric;
  v_order_count integer;
  v_order_count_90d integer;
  v_last_order_at timestamptz;
  v_last_visit_at timestamptz;
  v_avg_basket_kg numeric;
  v_avg_gap_days numeric;
  v_product_mix jsonb;
  v_recent_orders jsonb;
  v_confidence text;
begin
  -- Permission check: caller must have this customer in their scope
  select exists(
    select 1 from user_scope_customers(auth.uid()) s where s.customer_id = p_customer_id
  ) into v_allowed;

  if not v_allowed then
    return jsonb_build_object('error', 'not_authorized');
  end if;

  -- Basic info
  select c.*, b.name as beat_name, b.id as beat_id
  into v_customer
  from customers c
  left join beats b on b.id = c.beat_id
  where c.id = p_customer_id;

  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  -- Aggregate kg from the order_items_kg view (Layer 1's foundation)
  -- which is the canonical source: it filters rejected/cancelled orders
  -- and only counts lines with kg.

  -- Last 30 days
  select coalesce(sum(kg), 0)
  into v_kg_30d
  from order_items_kg
  where customer_id = p_customer_id
    and order_created_at >= now() - interval '30 days'
    and kg is not null;

  -- Previous 30 days (days 30-60 ago)
  select coalesce(sum(kg), 0)
  into v_kg_prev_30d
  from order_items_kg
  where customer_id = p_customer_id
    and order_created_at >= now() - interval '60 days'
    and order_created_at < now() - interval '30 days'
    and kg is not null;

  -- Last 90 days
  select coalesce(sum(kg), 0)
  into v_kg_90d
  from order_items_kg
  where customer_id = p_customer_id
    and order_created_at >= now() - interval '90 days'
    and kg is not null;

  -- Lifetime
  select coalesce(sum(kg), 0)
  into v_kg_lifetime
  from order_items_kg
  where customer_id = p_customer_id
    and kg is not null;

  -- Order counts + last order
  select count(distinct order_id), max(order_created_at)
  into v_order_count, v_last_order_at
  from order_items_kg
  where customer_id = p_customer_id;

  select count(distinct order_id)
  into v_order_count_90d
  from order_items_kg
  where customer_id = p_customer_id
    and order_created_at >= now() - interval '90 days';

  -- Last visit
  select max(visited_at)
  into v_last_visit_at
  from customer_visits
  where customer_id = p_customer_id;

  -- Average basket kg (over orders that have kg lines)
  select coalesce(avg(order_kg), 0)
  into v_avg_basket_kg
  from (
    select order_id, sum(kg) as order_kg
    from order_items_kg
    where customer_id = p_customer_id
      and kg is not null
    group by order_id
  ) t;

  -- Average gap days between orders (only when ≥2 orders).
  -- date - date returns integer days directly (no extract needed).
  with order_dates as (
    select distinct date(order_created_at) as d
    from order_items_kg
    where customer_id = p_customer_id
    order by d
  ),
  gaps as (
    select (d - lag(d) over (order by d))::numeric as gap
    from order_dates
  )
  select coalesce(avg(gap), 0)
  into v_avg_gap_days
  from gaps
  where gap is not null;

  -- Product mix (top 6 by kg, last 90 days)
  select coalesce(jsonb_agg(row_to_json(t) order by t.kg desc), '[]'::jsonb)
  into v_product_mix
  from (
    select
      product_name,
      product_id,
      sum(kg) as kg,
      count(*) as line_count
    from order_items_kg
    where customer_id = p_customer_id
      and order_created_at >= now() - interval '90 days'
      and kg is not null
    group by product_name, product_id
    order by sum(kg) desc
    limit 6
  ) t;

  -- Last 10 orders
  with orders_summary as (
    select
      order_id,
      max(order_created_at) as order_created_at,
      sum(kg) filter (where kg is not null) as kg,
      count(*) as line_count,
      max(app_status) as app_status
    from order_items_kg
    where customer_id = p_customer_id
    group by order_id
  )
  select coalesce(jsonb_agg(row_to_json(o) order by o.order_created_at desc), '[]'::jsonb)
  into v_recent_orders
  from (
    select * from orders_summary
    order by order_created_at desc
    limit 10
  ) o;

  -- Confidence flag — how reliable are the numbers?
  v_confidence := case
    when v_order_count >= 10 then 'high'
    when v_order_count >= 5  then 'medium'
    when v_order_count >= 2  then 'low'
    else 'insufficient'
  end;

  return jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'mobile', v_customer.mobile,
    'city', v_customer.city,
    'beat_id', v_customer.beat_id,
    'beat_name', v_customer.beat_name,
    'created_at', v_customer.created_at,

    'kg_30d', v_kg_30d,
    'kg_prev_30d', v_kg_prev_30d,
    'kg_90d', v_kg_90d,
    'kg_lifetime', v_kg_lifetime,

    'growth_pct', case
      when v_kg_prev_30d > 0 then round((v_kg_30d - v_kg_prev_30d) / v_kg_prev_30d * 100, 1)
      when v_kg_30d > 0 then 100  -- new activity from nothing
      else 0
    end,

    'order_count', v_order_count,
    'order_count_90d', v_order_count_90d,
    'last_order_at', v_last_order_at,
    'days_since_last_order', case
      when v_last_order_at is null then null
      else floor(extract(epoch from now() - v_last_order_at) / 86400)::integer
    end,

    'last_visit_at', v_last_visit_at,
    'days_since_last_visit', case
      when v_last_visit_at is null then null
      else floor(extract(epoch from now() - v_last_visit_at) / 86400)::integer
    end,

    'avg_basket_kg', round(v_avg_basket_kg, 1),
    'avg_gap_days', round(v_avg_gap_days, 1),

    'product_mix', v_product_mix,
    'recent_orders', v_recent_orders,

    'confidence', v_confidence
  );
end;
$$;

grant execute on function customer_detail(uuid) to authenticated;

-- Verification:
--   select customer_detail('some-uuid-here'::uuid);
