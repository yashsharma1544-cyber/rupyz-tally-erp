-- =============================================================================
-- 49_invoice_step.sql — Insert an Invoice step between Approve and Load
-- =============================================================================
-- Adds:
--   1. order_app_status enum value 'invoiced'  (sortorder 2.25, between
--      'approved' (2) and 'loading' (2.5))
--   2. user_role enum value 'billing'          (separate from admin)
--   3. orders.invoice_number  text             (manual, from Tally)
--      orders.invoiced_at     timestamptz      (when set)
--      orders.invoiced_by     uuid             (which app_user)
--   4. index for invoice number lookup
--   5. consistency check — all three invoice fields move together
--
-- NOT enforced here (must be done in app code):
--   - Only admin/billing roles may set invoice_number
--   - Load action must check status='invoiced' before transitioning
--
-- Run this migration in Supabase SQL editor as one block; ALTER TYPE
-- statements on Postgres 12+ commit independently so no transaction
-- ceremony is needed.
-- =============================================================================

-- 1. Add 'invoiced' to order_app_status, before 'loading'
alter type order_app_status add value if not exists 'invoiced' before 'loading';

-- 2. Add 'billing' to user_role
alter type user_role add value if not exists 'billing';

-- 3. Add columns to orders
alter table orders
  add column if not exists invoice_number text,
  add column if not exists invoiced_at    timestamptz,
  add column if not exists invoiced_by    uuid references app_users(id);

-- 4. Index for searching by invoice number
create index if not exists orders_invoice_number_idx
  on orders(invoice_number)
  where invoice_number is not null;

-- 5. Consistency check — all three fields populated together or all NULL
alter table orders
  drop constraint if exists orders_invoice_fields_consistent;
alter table orders
  add constraint orders_invoice_fields_consistent check (
    (invoice_number is null and invoiced_at is null and invoiced_by is null)
    or
    (invoice_number is not null and invoiced_at is not null and invoiced_by is not null)
  );

-- Verify
select 'enum_check' as kind, enumlabel, enumsortorder
  from pg_enum where enumtypid = 'order_app_status'::regtype
   and enumlabel in ('approved','invoiced','loading') order by enumsortorder;
