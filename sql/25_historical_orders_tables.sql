-- ============================================================================
-- 25 — Historical orders from Tally backfill (FY 25-26)
--
-- One-time import of pre-Rupyz sales from Tally. Kept in separate tables so:
--   • Doesn't pollute the live orders table
--   • Different RLS / read-only semantics
--   • Easy to truncate and re-import if the matching is wrong
--
-- These tables shadow the structure of `orders` + `order_items` but with
-- only the columns we actually have from Tally. Other Rupyz-specific fields
-- (app_status, rupyz_order_id, salesman_id, etc.) are intentionally absent.
--
-- Idempotency: unique key on (voucher_number, voucher_date) — running import
-- twice with the same Excel won't duplicate.
-- ============================================================================

-- Flag for customers created from Tally backfill (not active in Rupyz)
alter table customers
  add column if not exists is_historical_only boolean not null default false;

comment on column customers.is_historical_only is
  'TRUE for customers created during Tally backfill that have no Rupyz activity. These customers do not appear in dispatch/order flows but show up in historical insights.';

create index if not exists idx_customers_is_historical on customers(is_historical_only) where is_historical_only = true;

-- Historical orders (voucher headers)
create table if not exists historical_orders (
  id               uuid primary key default gen_random_uuid(),
  voucher_number   text not null,
  voucher_date     date not null,
  voucher_type     text,
  customer_id      uuid references customers(id) on delete restrict,
  party_name_raw   text not null,  -- original Tally name, kept for audit
  total_amount     numeric(12, 2) not null default 0,
  line_count       integer not null default 0,
  source           text not null default 'tally_25_26',
  imported_at      timestamptz not null default now(),
  unique (voucher_number, voucher_date)
);

create index if not exists idx_historical_orders_customer on historical_orders(customer_id);
create index if not exists idx_historical_orders_date on historical_orders(voucher_date);

-- Historical order items
create table if not exists historical_order_items (
  id                    uuid primary key default gen_random_uuid(),
  historical_order_id   uuid not null references historical_orders(id) on delete cascade,
  product_id            uuid references products(id) on delete set null,
  item_name_raw         text not null,    -- original Tally name
  qty                   numeric(12, 3) not null,
  rate                  numeric(12, 4),
  amount                numeric(12, 2),
  kg                    numeric(12, 4),   -- computed at import time using product.weight_kg
  unit_raw              text              -- whatever Tally said (e.g. 'kg', 'packet', or NULL)
);

create index if not exists idx_historical_items_order on historical_order_items(historical_order_id);
create index if not exists idx_historical_items_product on historical_order_items(product_id);

-- RLS — read-only for all authenticated, no write/update/delete from app
alter table historical_orders enable row level security;
alter table historical_order_items enable row level security;

drop policy if exists "read all historical orders" on historical_orders;
create policy "read all historical orders" on historical_orders
  for select to authenticated using (true);

drop policy if exists "read all historical items" on historical_order_items;
create policy "read all historical items" on historical_order_items
  for select to authenticated using (true);

-- Verify:
--   select count(*) from historical_orders;     -- 0 until import runs
--   select count(*) from historical_order_items;
