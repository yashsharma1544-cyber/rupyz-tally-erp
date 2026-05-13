-- ============================================================================
-- 30 — Call list RPC
--
-- Returns three buckets for "who needs attention this week":
--
--   sleeping     — no order in 30+ days, ranked by 90d kg (high-value first)
--   shrinking    — last 30d kg vs prev 30d kg is down ≥10%, ranked by absolute drop
--   new_stuck    — created in last 90 days, has ≤2 lifetime orders, last order
--                  was 14+ days ago (or never ordered), ranked by days-since-created
--
-- Scoped via user_scope_customers — admin sees all, salesman sees own.
--
-- Limit per bucket: 30 (keeps response small; bucket counts available for UI)
-- ============================================================================

create or replace function call_list_summary(p_view_as_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_self_role text;
  v_scope_user_id uuid;
  v_result jsonb;
begin
  v_self_id := auth.uid();
  
  -- Caller must be authenticated
  if v_self_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  
  -- Look up caller's role
  select role into v_self_role from app_users where id = v_self_id and active = true;
  if v_self_role is null then
    return jsonb_build_object('error', 'not_authorized');
  end if;
  
  -- Admin override: ?as_user= lets admin view as someone else
  if p_view_as_user_id is not null then
    if v_self_role <> 'admin' then
      return jsonb_build_object('error', 'override_admin_only');
    end if;
    v_scope_user_id := p_view_as_user_id;
  else
    v_scope_user_id := v_self_id;
  end if;

  -- Build buckets
  with
  scope as (
    select customer_id as cid from user_scope_customers(v_scope_user_id)
  ),
  customer_stats as (
    select
      c.id,
      c.name,
      c.mobile,
      c.city,
      c.created_at,
      b.id as beat_id,
      b.name as beat_name,
      -- last order
      (select max(order_created_at) from order_items_kg where customer_id = c.id) as last_order_at,
      -- 30d kg
      coalesce((
        select sum(kg) from order_items_kg
        where customer_id = c.id and order_created_at >= now() - interval '30 days' and kg is not null
      ), 0) as kg_30d,
      -- prev 30d kg
      coalesce((
        select sum(kg) from order_items_kg
        where customer_id = c.id
          and order_created_at >= now() - interval '60 days'
          and order_created_at < now() - interval '30 days'
          and kg is not null
      ), 0) as kg_prev_30d,
      -- 90d kg
      coalesce((
        select sum(kg) from order_items_kg
        where customer_id = c.id and order_created_at >= now() - interval '90 days' and kg is not null
      ), 0) as kg_90d,
      -- lifetime orders
      (select count(distinct order_id) from order_items_kg where customer_id = c.id) as order_count
    from customers c
    join scope s on s.cid = c.id
    left join beats b on b.id = c.beat_id
  ),
  enriched as (
    select
      *,
      case
        when last_order_at is null then null
        else floor(extract(epoch from now() - last_order_at) / 86400)::integer
      end as days_since_last_order,
      case
        when kg_prev_30d > 0 then round((kg_30d - kg_prev_30d) / kg_prev_30d * 100, 1)
        when kg_30d > 0 then 100
        else 0
      end as growth_pct,
      floor(extract(epoch from now() - created_at) / 86400)::integer as days_since_created
    from customer_stats
  ),
  sleeping_b as (
    select * from enriched
    where last_order_at is null
       or days_since_last_order >= 30
    order by kg_90d desc nulls last, days_since_last_order desc nulls last
    limit 30
  ),
  shrinking_b as (
    select * from enriched
    where kg_prev_30d > 0
      and growth_pct <= -10
      and (days_since_last_order is null or days_since_last_order < 30)  -- exclude already-sleeping
    order by (kg_prev_30d - kg_30d) desc  -- biggest absolute drop first
    limit 30
  ),
  new_stuck_b as (
    select * from enriched
    where days_since_created <= 90
      and order_count <= 2
      and (days_since_last_order is null or days_since_last_order >= 14)
    order by days_since_created asc
    limit 30
  ),
  sleeping_count as (select count(*) as n from enriched where last_order_at is null or days_since_last_order >= 30),
  shrinking_count as (select count(*) as n from enriched where kg_prev_30d > 0 and growth_pct <= -10 and (days_since_last_order is null or days_since_last_order < 30)),
  new_stuck_count as (select count(*) as n from enriched where days_since_created <= 90 and order_count <= 2 and (days_since_last_order is null or days_since_last_order >= 14))
  select jsonb_build_object(
    'sleeping', coalesce((select jsonb_agg(row_to_json(s)) from sleeping_b s), '[]'::jsonb),
    'shrinking', coalesce((select jsonb_agg(row_to_json(s)) from shrinking_b s), '[]'::jsonb),
    'new_stuck', coalesce((select jsonb_agg(row_to_json(s)) from new_stuck_b s), '[]'::jsonb),
    'sleeping_total', (select n from sleeping_count),
    'shrinking_total', (select n from shrinking_count),
    'new_stuck_total', (select n from new_stuck_count),
    'scope_user_id', v_scope_user_id,
    'is_override', (p_view_as_user_id is not null)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function call_list_summary(uuid) to authenticated;
grant execute on function call_list_summary() to authenticated;

-- Verification:
--   select call_list_summary();
--   Returns a JSONB with sleeping/shrinking/new_stuck arrays and totals.
