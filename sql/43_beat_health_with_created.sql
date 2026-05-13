-- ============================================================================
-- 43 — beat_customer_health: add customer_created_at + total_order_count
--
-- Adds two columns needed by the new "New stuck" tab on /beats/[id]:
--   customer_created_at   — onboarding date (filter by ≤90d age)
--   total_order_count     — lifetime orders (filter by ≤2)
-- ============================================================================

drop function if exists beat_customer_health(uuid);

create or replace function beat_customer_health(p_beat_id uuid)
returns table (
  customer_id          uuid,
  customer_name        text,
  customer_city        text,
  customer_mobile      text,
  customer_created_at  timestamptz,
  this_30d_kg          numeric,
  prev_30d_kg          numeric,
  this_90d_kg          numeric,
  this_30d_order_count bigint,
  this_90d_order_count bigint,
  total_order_count    bigint,
  last_order_at        timestamptz,
  days_since_last      integer,
  days_since_created   integer,
  growth_pct           numeric
)
language sql
stable
as $$
  with cust as (
    select id, name, city, mobile, created_at
    from customers
    where beat_id = p_beat_id
  ),
  this_30 as (
    select customer_id,
           sum(kg) as kg,
           count(distinct order_id) as orders
    from order_items_kg
    where customer_id in (select id from cust)
      and order_created_at >= now() - interval '30 days'
      and app_status not in ('rejected', 'cancelled')
    group by customer_id
  ),
  prev_30 as (
    select customer_id,
           sum(kg) as kg
    from order_items_kg
    where customer_id in (select id from cust)
      and order_created_at >= now() - interval '60 days'
      and order_created_at <  now() - interval '30 days'
      and app_status not in ('rejected', 'cancelled')
    group by customer_id
  ),
  this_90 as (
    select customer_id,
           sum(kg) as kg,
           count(distinct order_id) as orders
    from order_items_kg
    where customer_id in (select id from cust)
      and order_created_at >= now() - interval '90 days'
      and app_status not in ('rejected', 'cancelled')
    group by customer_id
  ),
  lifetime_orders as (
    select customer_id,
           count(*) as orders
    from orders
    where customer_id in (select id from cust)
      and app_status not in ('rejected', 'cancelled')
    group by customer_id
  ),
  last_o as (
    select customer_id,
           max(rupyz_created_at) as last_order_at
    from orders
    where customer_id in (select id from cust)
      and app_status not in ('rejected', 'cancelled')
    group by customer_id
  )
  select
    c.id                               as customer_id,
    coalesce(c.name, '')               as customer_name,
    coalesce(c.city, '')               as customer_city,
    coalesce(c.mobile, '')             as customer_mobile,
    c.created_at                       as customer_created_at,
    coalesce(t30.kg, 0)::numeric       as this_30d_kg,
    coalesce(p30.kg, 0)::numeric       as prev_30d_kg,
    coalesce(t90.kg, 0)::numeric       as this_90d_kg,
    coalesce(t30.orders, 0)::bigint    as this_30d_order_count,
    coalesce(t90.orders, 0)::bigint    as this_90d_order_count,
    coalesce(lo_count.orders, 0)::bigint as total_order_count,
    lo.last_order_at,
    case when lo.last_order_at is null then null
         else extract(day from (now() - lo.last_order_at))::integer
    end                                as days_since_last,
    extract(day from (now() - c.created_at))::integer as days_since_created,
    case
      when coalesce(p30.kg, 0) = 0 then null
      else round(((coalesce(t30.kg, 0) - p30.kg) / p30.kg) * 100, 1)
    end                                as growth_pct
  from cust c
  left join this_30 t30 on t30.customer_id = c.id
  left join prev_30 p30 on p30.customer_id = c.id
  left join this_90 t90 on t90.customer_id = c.id
  left join lifetime_orders lo_count on lo_count.customer_id = c.id
  left join last_o lo on lo.customer_id = c.id
  order by coalesce(t30.kg, 0) desc, c.name;
$$;

grant execute on function beat_customer_health(uuid) to authenticated;
