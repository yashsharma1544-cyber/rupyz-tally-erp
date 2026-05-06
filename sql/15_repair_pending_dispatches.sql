-- ============================================================================
-- 15 — Repair: PWA-created dispatches were left as 'pending', so order status
-- never advanced from 'approved' to 'dispatched'. Two effects:
--   • orders show in the dispatch list forever
--   • re-dispatching them fails (qty already consumed by pending row)
--
-- Fix: advance any 'pending' dispatch created by the PWA flow to 'shipped',
-- then recompute order status. Dispatchers will use shipDispatch only on
-- desktop now; PWA creates 'shipped' directly going forward (code change).
-- ============================================================================

-- Step 1: Advance ALL pending dispatches to shipped.
-- This is safe because the PWA's intent when it creates a dispatch IS that
-- the truck is loading. The 'pending' state was an artifact of reusing
-- createDispatch which defaults to 'pending'.
update dispatches
set status = 'shipped',
    shipped_at = coalesce(shipped_at, now())
where status = 'pending';

-- Step 2: Recompute app_status for orders that have dispatches.
-- For each order, if all items have full shipped qty, mark as 'dispatched'.
-- If some items have any shipped qty (but not all), mark 'partially_dispatched'.
-- If nothing shipped, leave as 'approved'.
with order_progress as (
  select
    o.id as order_id,
    o.app_status,
    sum(oi.qty) as total_ordered,
    coalesce(sum(
      case when d.status in ('shipped', 'delivered') then di.qty else 0 end
    ), 0) as total_shipped,
    coalesce(sum(
      case when d.status = 'delivered' then di.qty else 0 end
    ), 0) as total_delivered
  from orders o
  join order_items oi on oi.order_id = o.id
  left join dispatch_items di on di.order_item_id = oi.id
  left join dispatches d on d.id = di.dispatch_id
  where o.app_status in ('approved', 'partially_dispatched', 'dispatched')
  group by o.id, o.app_status
)
update orders
set app_status = case
  when op.total_delivered >= op.total_ordered then 'delivered'
  when op.total_shipped >= op.total_ordered then 'dispatched'
  when op.total_shipped > 0 then 'partially_dispatched'
  else 'approved'
end::order_app_status
from order_progress op
where orders.id = op.order_id
  and orders.app_status::text <> case
    when op.total_delivered >= op.total_ordered then 'delivered'
    when op.total_shipped >= op.total_ordered then 'dispatched'
    when op.total_shipped > 0 then 'partially_dispatched'
    else 'approved'
  end;

-- Verification: any orders still 'approved' with fully-dispatched items?
-- This should return 0 rows after the fix.
select o.id, o.rupyz_order_id, o.app_status, c.name,
       sum(oi.qty) as ordered_total,
       coalesce(sum(case when d.status in ('shipped','delivered') then di.qty else 0 end), 0) as shipped_total
from orders o
join customers c on c.id = o.customer_id
join order_items oi on oi.order_id = o.id
left join dispatch_items di on di.order_item_id = oi.id
left join dispatches d on d.id = di.dispatch_id
where o.app_status in ('approved', 'partially_dispatched')
group by o.id, o.rupyz_order_id, o.app_status, c.name
having coalesce(sum(case when d.status in ('shipped','delivered') then di.qty else 0 end), 0) >= sum(oi.qty)
order by c.name;
