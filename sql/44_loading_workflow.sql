-- ============================================================================
-- 44 — Loading workflow support
--
-- Adds:
--   1. 'loaded' status to order_app_status enum (between 'loading' and 'partially_dispatched')
--   2. loaded_qty column on order_items (NULL until loading team enters a value)
--   3. loaded_at, loaded_by on orders (audit trail of who loaded and when)
--
-- This enables the new /load PWA:
--   approved → (team opens order) → loading → (team marks loaded) → loaded
--                                                                     ↓
--                                                          /dispatch picks up to finalize
-- ============================================================================

-- 1. Add 'loaded' to the enum.
-- Postgres allows adding enum values but NOT inside a transaction in older versions.
-- Supabase runs each statement separately so this is safe.
alter type order_app_status add value if not exists 'loaded' after 'loading';

-- 2. Add loaded_qty per line.
-- NULL = not yet loaded. Numeric matches the existing qty column type.
alter table order_items
  add column if not exists loaded_qty numeric;

comment on column order_items.loaded_qty is
  'Actual quantity loaded onto the truck by the loading team. NULL until loaded.';

-- 3. Audit columns on orders.
alter table orders
  add column if not exists loaded_at timestamptz,
  add column if not exists loaded_by uuid references app_users(id);

comment on column orders.loaded_at is
  'Timestamp when the loading team marked this order as fully loaded.';
comment on column orders.loaded_by is
  'app_user who marked this order as loaded.';

-- Verification queries (paste these in separately after running the above):
--
-- 1. Check enum:
--    select unnest(enum_range(null::order_app_status));
--    Should include 'loaded' after 'loading'.
--
-- 2. Check column added:
--    select column_name, data_type
--    from information_schema.columns
--    where table_name = 'order_items' and column_name = 'loaded_qty';
--
-- 3. Check audit columns:
--    select column_name, data_type
--    from information_schema.columns
--    where table_name = 'orders' and column_name in ('loaded_at', 'loaded_by');
