-- =============================================================================
-- Vehicle stock tracking for Out-for-Delivery dispatches
--
-- One row per (dispatch, item) with:
--   loaded_qty / loaded_kg  — what physically went on the vehicle
--   (auto-populated from the invoice line items when the dispatch is created;
--    user can edit if the physical load differs from the invoiced quantity)
--   returned_qty / returned_kg — what came back to the warehouse
--   returned_at / returned_by — audit stamp when end-of-trip recorded
--
-- "Delivered" qty is computed live on the frontend (sum of line items from
-- invoices with delivered_at set), not persisted, so there's no drift when a
-- single invoice is marked delivered.
--
-- Variance = loaded - delivered - returned. Should be 0 after a clean trip.
-- A non-zero variance surfaces missing-stock issues (sold off-the-books,
-- damaged, pilfered, miscounted at loading).
--
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.tally_dispatch_loads (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.tally_dispatches(id) on delete cascade,
  item_name text not null,
  hsn text,
  loaded_qty numeric default 0,
  loaded_kg numeric default 0,
  returned_qty numeric default 0,
  returned_kg numeric default 0,
  returned_at timestamptz,
  returned_by uuid,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(dispatch_id, item_name)
);

create index if not exists tally_dispatch_loads_dispatch_idx on public.tally_dispatch_loads (dispatch_id);

-- Convenience view: dispatch items with live-computed delivered + variance
create or replace view public.v_dispatch_item_summary as
select
  dl.dispatch_id,
  dl.id as load_id,
  dl.item_name,
  dl.hsn,
  dl.loaded_qty,
  dl.loaded_kg,
  coalesce(sum(case when ti.delivered_at is not null then til.qty else 0 end), 0) as delivered_qty,
  coalesce(sum(case when ti.delivered_at is not null then til.qty_kg else 0 end), 0) as delivered_kg,
  dl.returned_qty,
  dl.returned_kg,
  dl.loaded_qty - coalesce(sum(case when ti.delivered_at is not null then til.qty else 0 end), 0) - dl.returned_qty as variance_qty,
  dl.loaded_kg - coalesce(sum(case when ti.delivered_at is not null then til.qty_kg else 0 end), 0) - dl.returned_kg as variance_kg,
  dl.returned_at,
  dl.returned_by,
  dl.notes
from public.tally_dispatch_loads dl
left join public.tally_invoices ti on ti.dispatch_id = dl.dispatch_id
left join public.tally_invoice_lines til on til.invoice_id = ti.id and til.item_name = dl.item_name
group by dl.dispatch_id, dl.id, dl.item_name, dl.hsn, dl.loaded_qty, dl.loaded_kg,
         dl.returned_qty, dl.returned_kg, dl.returned_at, dl.returned_by, dl.notes;

-- Backfill: for existing dispatches (if any), populate loads from invoice lines
-- Idempotent via ON CONFLICT.
insert into public.tally_dispatch_loads (dispatch_id, item_name, hsn, loaded_qty, loaded_kg)
select
  ti.dispatch_id,
  til.item_name,
  max(til.hsn) as hsn,
  sum(til.qty) as loaded_qty,
  sum(til.qty_kg) as loaded_kg
from public.tally_invoices ti
join public.tally_invoice_lines til on til.invoice_id = ti.id
where ti.dispatch_id is not null
  and til.item_name is not null
group by ti.dispatch_id, til.item_name
on conflict (dispatch_id, item_name) do nothing;

select 'ok' as status,
  (select count(*) from public.tally_dispatch_loads) as load_rows,
  (select count(distinct dispatch_id) from public.tally_dispatch_loads) as dispatches_with_loads;
