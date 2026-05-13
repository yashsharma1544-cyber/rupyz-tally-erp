-- ============================================================================
-- 22 — order_items_kg view: convert every order line to kg
--
-- Priority:
--   1. If product has weight_kg → qty * weight_kg
--   2. Else if order line unit = 'kg' → qty
--   3. Else if order line unit = 'g'/'gm'/'gram(s)' → qty / 1000
--   4. Else NULL (excluded from kg-based analytics)
--
-- Joined with order metadata (customer, beat, dates) so downstream views
-- don't need to re-join orders/customers.
-- ============================================================================

create or replace view order_items_kg as
select
  oi.id                              as order_item_id,
  oi.order_id,
  o.rupyz_order_id,
  o.app_status,
  o.rupyz_created_at                 as order_created_at,
  o.customer_id,
  c.beat_id,
  oi.product_id,
  oi.product_name,
  oi.qty,
  oi.unit                            as line_unit,
  p.weight_kg                        as product_weight_kg,
  -- The conversion itself
  case
    when p.weight_kg is not null then oi.qty * p.weight_kg
    when lower(coalesce(oi.unit, '')) = 'kg' then oi.qty
    when lower(coalesce(oi.unit, '')) in ('g', 'gm', 'gram', 'grams') then oi.qty / 1000.0
    else null
  end                                as kg
from order_items oi
join orders o    on o.id = oi.order_id
join customers c on c.id = o.customer_id
left join products p on p.id = oi.product_id;

grant select on order_items_kg to authenticated;

-- Coverage check:
--   select count(*) filter (where kg is not null) as kg_lines,
--          count(*) as total_lines,
--          round(100.0 * count(*) filter (where kg is not null) / count(*), 1) as pct_with_kg
--   from order_items_kg;
