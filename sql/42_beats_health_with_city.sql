-- ============================================================================
-- 42 — beats_health_summary: include beat_city (area)
--
-- Adds beat_city to the existing summary so the new /beats analytics page
-- can show an "Area" column merged from the old beats CRUD page.
-- ============================================================================

drop function if exists beats_health_summary();

create or replace function beats_health_summary()
returns table (
  beat_id              uuid,
  beat_name            text,
  beat_city            text,
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
    b.city                                                                     as beat_city,
    count(pc.customer_id)::bigint                                              as customer_count,
    count(*) filter (where pc.this_30d_kg > 0)::bigint                         as active_30d_count,
    count(*) filter (where pc.customer_id is not null
                       and (pc.last_order_at is null
                            or pc.last_order_at < now() - interval '30 days'))::bigint as sleeping_count,
    coalesce(sum(pc.this_30d_kg), 0)::numeric                                  as this_30d_kg,
    coalesce(sum(pc.prev_30d_kg), 0)::numeric                                  as prev_30d_kg,
    case
      when coalesce(sum(pc.prev_30d_kg), 0) = 0 then null
      else round(((sum(pc.this_30d_kg) - sum(pc.prev_30d_kg)) / sum(pc.prev_30d_kg)) * 100, 1)
    end                                                                        as growth_pct
  from beats b
  left join per_cust pc on pc.beat_id = b.id
  group by b.id, b.name, b.city
  order by b.name;
$$;

grant execute on function beats_health_summary() to authenticated;
