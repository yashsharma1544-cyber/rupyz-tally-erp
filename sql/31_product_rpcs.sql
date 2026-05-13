-- ============================================================================
-- 31 — Product analytics RPCs
--
-- products_overview(): returns rows for every active product + brand rollups.
-- product_detail(p_product_id): single product deep-dive.
-- Both scoped via user_scope_customers.
-- ============================================================================

create or replace function products_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role text;
  v_result jsonb;
  v_total_kg_30d numeric;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  select role into v_role from app_users where id = v_user_id and active = true;
  if v_role is null then
    return jsonb_build_object('error', 'not_authorized');
  end if;

  -- Total 30d kg for share % calculations
  with scope as (
    select customer_id as cid from user_scope_customers(v_user_id)
  )
  select coalesce(sum(oi.kg), 0)
  into v_total_kg_30d
  from order_items_kg oi
  join scope s on s.cid = oi.customer_id
  where oi.kg is not null
    and oi.order_created_at >= now() - interval '30 days';

  -- Per-product + per-brand aggregation
  with
  scope as (
    select customer_id as cid from user_scope_customers(v_user_id)
  ),
  filtered_lines as (
    select oi.*
    from order_items_kg oi
    join scope s on s.cid = oi.customer_id
    where oi.kg is not null
  ),
  product_agg as (
    select
      p.id as product_id,
      p.name as product_name,
      p.brand_id,
      b.name as brand_name,
      coalesce(sum(l.kg) filter (where l.order_created_at >= now() - interval '30 days'), 0) as kg_30d,
      coalesce(sum(l.kg) filter (where l.order_created_at >= now() - interval '60 days' and l.order_created_at < now() - interval '30 days'), 0) as kg_prev_30d,
      coalesce(sum(l.kg) filter (where l.order_created_at >= now() - interval '90 days'), 0) as kg_90d,
      coalesce(sum(l.kg), 0) as kg_lifetime,
      max(l.order_created_at) as last_sold_at,
      count(distinct l.customer_id) filter (where l.order_created_at >= now() - interval '30 days') as buyers_30d,
      count(distinct l.customer_id) filter (where l.order_created_at >= now() - interval '90 days') as buyers_90d
    from products p
    left join brands b on b.id = p.brand_id
    left join filtered_lines l on l.product_id = p.id
    where coalesce(p.active, true) = true
    group by p.id, p.name, p.brand_id, b.name
  ),
  product_enriched as (
    select *,
      case
        when kg_prev_30d > 0 then round((kg_30d - kg_prev_30d) / kg_prev_30d * 100, 1)
        when kg_30d > 0 then 100
        else 0
      end as growth_pct,
      case
        when last_sold_at is null then null
        else floor(extract(epoch from now() - last_sold_at) / 86400)::integer
      end as days_since_last_sold,
      case
        when v_total_kg_30d > 0 then round(kg_30d / v_total_kg_30d * 100, 1)
        else 0
      end as share_pct_30d
    from product_agg
  ),
  brand_agg as (
    select
      brand_id,
      coalesce(max(brand_name), 'Unbranded') as brand_name,
      sum(kg_30d) as kg_30d,
      sum(kg_prev_30d) as kg_prev_30d,
      sum(kg_90d) as kg_90d,
      sum(kg_lifetime) as kg_lifetime,
      count(*) as sku_count,
      count(*) filter (where kg_30d > 0) as active_sku_count
    from product_enriched
    group by brand_id
  ),
  brand_enriched as (
    select *,
      case
        when kg_prev_30d > 0 then round((kg_30d - kg_prev_30d) / kg_prev_30d * 100, 1)
        when kg_30d > 0 then 100
        else 0
      end as growth_pct,
      case
        when v_total_kg_30d > 0 then round(kg_30d / v_total_kg_30d * 100, 1)
        else 0
      end as share_pct_30d
    from brand_agg
  )
  select jsonb_build_object(
    'products', coalesce((select jsonb_agg(row_to_json(p) order by p.kg_30d desc, p.kg_lifetime desc) from product_enriched p), '[]'::jsonb),
    'brands',   coalesce((select jsonb_agg(row_to_json(b) order by b.kg_30d desc, b.kg_lifetime desc) from brand_enriched b),   '[]'::jsonb),
    'total_kg_30d', v_total_kg_30d
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function products_overview() to authenticated;


-- ----------------------------------------------------------------------------
create or replace function product_detail(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role text;
  v_product record;
  v_kg_30d numeric;
  v_kg_prev_30d numeric;
  v_kg_90d numeric;
  v_kg_lifetime numeric;
  v_buyers_30d integer;
  v_buyers_90d integer;
  v_last_sold_at timestamptz;
  v_top_buyers jsonb;
  v_recent_stoppers jsonb;
  v_beats jsonb;
  v_result jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;
  select role into v_role from app_users where id = v_user_id and active = true;
  if v_role is null then
    return jsonb_build_object('error', 'not_authorized');
  end if;

  select p.id, p.name, p.weight_kg, p.brand_id, b.name as brand_name
  into v_product
  from products p
  left join brands b on b.id = p.brand_id
  where p.id = p_product_id;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  -- Aggregates
  with scope as (select customer_id as cid from user_scope_customers(v_user_id))
  select
    coalesce(sum(oi.kg) filter (where oi.order_created_at >= now() - interval '30 days'), 0),
    coalesce(sum(oi.kg) filter (where oi.order_created_at >= now() - interval '60 days' and oi.order_created_at < now() - interval '30 days'), 0),
    coalesce(sum(oi.kg) filter (where oi.order_created_at >= now() - interval '90 days'), 0),
    coalesce(sum(oi.kg), 0),
    count(distinct oi.customer_id) filter (where oi.order_created_at >= now() - interval '30 days'),
    count(distinct oi.customer_id) filter (where oi.order_created_at >= now() - interval '90 days'),
    max(oi.order_created_at)
  into v_kg_30d, v_kg_prev_30d, v_kg_90d, v_kg_lifetime, v_buyers_30d, v_buyers_90d, v_last_sold_at
  from order_items_kg oi
  join scope s on s.cid = oi.customer_id
  where oi.product_id = p_product_id and oi.kg is not null;

  -- Top 10 buyers by 90d kg
  with scope as (select customer_id as cid from user_scope_customers(v_user_id))
  select coalesce(jsonb_agg(row_to_json(t) order by t.kg_90d desc), '[]'::jsonb)
  into v_top_buyers
  from (
    select
      c.id as customer_id,
      c.name as customer_name,
      c.mobile,
      b.name as beat_name,
      sum(oi.kg) filter (where oi.order_created_at >= now() - interval '90 days') as kg_90d,
      sum(oi.kg) filter (where oi.order_created_at >= now() - interval '30 days') as kg_30d,
      max(oi.order_created_at) as last_order_at
    from order_items_kg oi
    join scope s on s.cid = oi.customer_id
    join customers c on c.id = oi.customer_id
    left join beats b on b.id = c.beat_id
    where oi.product_id = p_product_id
      and oi.kg is not null
      and oi.order_created_at >= now() - interval '90 days'
    group by c.id, c.name, c.mobile, b.name
    having sum(oi.kg) filter (where oi.order_created_at >= now() - interval '90 days') > 0
    order by sum(oi.kg) filter (where oi.order_created_at >= now() - interval '90 days') desc
    limit 10
  ) t;

  -- Recent stoppers: bought 30-90d ago, not in last 30d
  with scope as (select customer_id as cid from user_scope_customers(v_user_id))
  select coalesce(jsonb_agg(row_to_json(t) order by t.kg_in_prev desc), '[]'::jsonb)
  into v_recent_stoppers
  from (
    select
      c.id as customer_id,
      c.name as customer_name,
      c.mobile,
      b.name as beat_name,
      sum(oi.kg) as kg_in_prev,
      max(oi.order_created_at) as last_order_at
    from order_items_kg oi
    join scope s on s.cid = oi.customer_id
    join customers c on c.id = oi.customer_id
    left join beats b on b.id = c.beat_id
    where oi.product_id = p_product_id
      and oi.kg is not null
      and oi.order_created_at >= now() - interval '90 days'
      and oi.order_created_at <  now() - interval '30 days'
      and c.id not in (
        select oi2.customer_id from order_items_kg oi2
        where oi2.product_id = p_product_id
          and oi2.order_created_at >= now() - interval '30 days'
          and oi2.customer_id in (select cid from scope)
      )
    group by c.id, c.name, c.mobile, b.name
    having sum(oi.kg) > 0
    order by sum(oi.kg) desc
    limit 15
  ) t;

  -- Beat breakdown
  with scope as (select customer_id as cid from user_scope_customers(v_user_id))
  select coalesce(jsonb_agg(row_to_json(t) order by t.kg_90d desc), '[]'::jsonb)
  into v_beats
  from (
    select
      b.id as beat_id,
      coalesce(b.name, 'No beat') as beat_name,
      sum(oi.kg) filter (where oi.order_created_at >= now() - interval '90 days') as kg_90d,
      sum(oi.kg) filter (where oi.order_created_at >= now() - interval '30 days') as kg_30d,
      count(distinct oi.customer_id) filter (where oi.order_created_at >= now() - interval '30 days') as buyers_30d
    from order_items_kg oi
    join scope s on s.cid = oi.customer_id
    join customers c on c.id = oi.customer_id
    left join beats b on b.id = c.beat_id
    where oi.product_id = p_product_id
      and oi.kg is not null
      and oi.order_created_at >= now() - interval '90 days'
    group by b.id, b.name
    having sum(oi.kg) filter (where oi.order_created_at >= now() - interval '90 days') > 0
  ) t;

  v_result := jsonb_build_object(
    'id', v_product.id,
    'name', v_product.name,
    'brand_id', v_product.brand_id,
    'brand_name', v_product.brand_name,
    'weight_kg', v_product.weight_kg,
    'kg_30d', v_kg_30d,
    'kg_prev_30d', v_kg_prev_30d,
    'kg_90d', v_kg_90d,
    'kg_lifetime', v_kg_lifetime,
    'growth_pct', case
      when v_kg_prev_30d > 0 then round((v_kg_30d - v_kg_prev_30d) / v_kg_prev_30d * 100, 1)
      when v_kg_30d > 0 then 100
      else 0
    end,
    'buyers_30d', v_buyers_30d,
    'buyers_90d', v_buyers_90d,
    'last_sold_at', v_last_sold_at,
    'days_since_last_sold', case
      when v_last_sold_at is null then null
      else floor(extract(epoch from now() - v_last_sold_at) / 86400)::integer
    end,
    'top_buyers', v_top_buyers,
    'recent_stoppers', v_recent_stoppers,
    'beats', v_beats
  );
  return v_result;
end;
$$;

grant execute on function product_detail(uuid) to authenticated;
