-- =============================================================================
-- 51_pipeline_stage_summary.sql
--
-- One-call aggregation used by /pipeline header. Returns order_count + total_kg
-- per app_status for the 8 visible pipeline stages.
--
-- Kg logic mirrors lib/sales-monitor/format.ts and pipeline/page.tsx's
-- kgForItems(): prefer item.unit if it's kg/g, else fall back to
-- packaging_unit + packaging_size. Anything not in those units contributes 0.
-- =============================================================================

create or replace function pipeline_stage_summary()
returns table(app_status text, order_count int, total_kg numeric)
language sql stable
as $$
  with item_kg as (
    select
      o.id          as order_id,
      o.app_status::text as app_status,
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
      end as kg
    from orders o
    left join order_items oi on oi.order_id = o.id
    where o.app_status::text in (
      'received', 'approved', 'invoiced', 'loading', 'loaded',
      'dispatched', 'delivered', 'on_van_trip'
    )
  )
  select
    app_status,
    count(distinct order_id)::int as order_count,
    coalesce(sum(kg), 0)::numeric as total_kg
  from item_kg
  group by app_status;
$$;

-- Allow authenticated users to call it (RLS isn't applied to functions by default).
grant execute on function pipeline_stage_summary() to authenticated;

-- Verify
select * from pipeline_stage_summary() order by app_status;
