-- ============================================================================
-- 23 — beat_customer_health RPC: per-customer kg sales for a beat
--
-- For one beat, returns one row per customer with kg totals across:
--   • this_30d         (last 30 days, ending now)
--   • prev_30d         (30 days before that)
--   • this_90d         (last 90 days)
--   • last_order_at    (when did this customer last order?)
--
-- Plus growth_pct = ((this_30d - prev_30d) / prev_30d) * 100 when comparable.
-- Customers with zero orders in both windows are still included (helpful for
-- "who hasn't ordered in a long time" lists).
--
-- Includes ALL customers in the beat regardless of order activity, so the
-- "sleeping customers" list is comprehensive.
-- ============================================================================

drop function if exists beat_customer_health(uuid);

create or replace function beat_customer_health(p_beat_id uuid)
returns table (
  customer_id          uuid,
  customer_name        text,
  customer_city        text,
  customer_mobile      text,
  this_30d_kg          numeric,
  prev_30d_kg          numeric,
  this_90d_kg          numeric,
  this_30d_order_count bigint,
  this_90d_order_count bigint,
  last_order_at        timestamptz,
  days_since_last      integer,
  growth_pct           numeric  -- null when no comparable baseline
)
language sql
stable
as $$
  with cust as (
    select id, name, city, mobile
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
    coalesce(t30.kg, 0)::numeric       as this_30d_kg,
    coalesce(p30.kg, 0)::numeric       as prev_30d_kg,
    coalesce(t90.kg, 0)::numeric       as this_90d_kg,
    coalesce(t30.orders, 0)::bigint    as this_30d_order_count,
    coalesce(t90.orders, 0)::bigint    as this_90d_order_count,
    lo.last_order_at,
    case when lo.last_order_at is null then null
         else extract(day from (now() - lo.last_order_at))::integer
    end                                as days_since_last,
    case
      when coalesce(p30.kg, 0) = 0 then null
      else round(((coalesce(t30.kg, 0) - p30.kg) / p30.kg) * 100, 1)
    end                                as growth_pct
  from cust c
  left join this_30 t30 on t30.customer_id = c.id
  left join prev_30 p30 on p30.customer_id = c.id
  left join this_90 t90 on t90.customer_id = c.id
  left join last_o  lo  on lo.customer_id  = c.id
  order by coalesce(t30.kg, 0) desc, c.name;
$$;

grant execute on function beat_customer_health(uuid) to authenticated;

-- Sanity test (replace with a real beat id):
--   select * from beat_customer_health('00000000-0000-0000-0000-000000000000');

-- Beat-level summary RPC (rolls up the per-customer view to one row).
-- Used by the /insights index page.

drop function if exists beats_health_summary();

create or replace function beats_health_summary()
returns table (
  beat_id              uuid,
  beat_name            text,
  customer_count       bigint,
  active_30d_count     bigint,
  sleeping_count       bigint,    -- 30+ days no order
  this_30d_kg          numeric,
  prev_30d_kg          numeric,
  growth_pct           numeric
)
language sql
stable
as $$
  with per_cust as (
    select
      c.beat_id,
      c.id as customer_id,
      coalesce(t30.kg, 0)::numeric as this_30d_kg,
      coalesce(p30.kg, 0)::numeric as prev_30d_kg,
      lo.last_order_at
    from customers c
    left join lateral (
      select sum(kg) as kg
      from order_items_kg oik
      where oik.customer_id = c.id
        and oik.order_created_at >= now() - interval '30 days'
        and oik.app_status not in ('rejected', 'cancelled')
    ) t30 on true
    left join lateral (
      select sum(kg) as kg
      from order_items_kg oik
      where oik.customer_id = c.id
        and oik.order_created_at >= now() - interval '60 days'
        and oik.order_created_at <  now() - interval '30 days'
        and oik.app_status not in ('rejected', 'cancelled')
    ) p30 on true
    left join lateral (
      select max(rupyz_created_at) as last_order_at
      from orders o
      where o.customer_id = c.id
        and o.app_status not in ('rejected', 'cancelled')
    ) lo on true
  )
  select
    b.id                                                                       as beat_id,
    b.name                                                                     as beat_name,
    count(*)::bigint                                                           as customer_count,
    count(*) filter (where pc.this_30d_kg > 0)::bigint                         as active_30d_count,
    count(*) filter (where pc.last_order_at is null
                       or pc.last_order_at < now() - interval '30 days')::bigint as sleeping_count,
    coalesce(sum(pc.this_30d_kg), 0)::numeric                                  as this_30d_kg,
    coalesce(sum(pc.prev_30d_kg), 0)::numeric                                  as prev_30d_kg,
    case
      when coalesce(sum(pc.prev_30d_kg), 0) = 0 then null
      else round(((sum(pc.this_30d_kg) - sum(pc.prev_30d_kg)) / sum(pc.prev_30d_kg)) * 100, 1)
    end                                                                        as growth_pct
  from beats b
  left join per_cust pc on pc.beat_id = b.id
  group by b.id, b.name
  order by b.name;
$$;

grant execute on function beats_health_summary() to authenticated;

-- Sanity test:
--   select * from beats_health_summary();
