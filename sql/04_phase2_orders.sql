-- ============================================================================
-- Rupyz-Tally ERP — Phase 2 schema
-- Adds: orders, order_items, rupyz_session, rupyz_sync_log
-- Alters: customers, products, salesmen — adds rupyz_id (numeric Rupyz ID)
-- Idempotent. Run AFTER 03_phase1_5_auth_and_rls.sql.
-- ============================================================================

-- ---- helper: backfill rupyz_id from rupyz_code where it's all digits --------
alter table customers add column if not exists rupyz_id bigint;
alter table products  add column if not exists rupyz_id bigint;
alter table salesmen  add column if not exists rupyz_id bigint;

-- backfill
update customers set rupyz_id = rupyz_code::bigint
  where rupyz_id is null and rupyz_code ~ '^\d+$';
update products set rupyz_id = rupyz_code::bigint
  where rupyz_id is null and rupyz_code ~ '^\d+$';

-- enforce uniqueness AFTER backfill (lets unimported records stay null)
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'customers_rupyz_id_uniq') then
    create unique index customers_rupyz_id_uniq on customers(rupyz_id) where rupyz_id is not null;
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'products_rupyz_id_uniq') then
    create unique index products_rupyz_id_uniq on products(rupyz_id) where rupyz_id is not null;
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'salesmen_rupyz_id_uniq') then
    create unique index salesmen_rupyz_id_uniq on salesmen(rupyz_id) where rupyz_id is not null;
  end if;
end $$;

-- track which records were created automatically by the scraper (vs manually)
alter table customers add column if not exists is_stub boolean not null default false;
alter table products  add column if not exists is_stub boolean not null default false;
alter table salesmen  add column if not exists is_stub boolean not null default false;

-- ============================================================================
-- ENUMS
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'order_app_status') then
    create type order_app_status as enum (
      'received',              -- new from Rupyz, awaiting approval
      'approved',              -- approver gave green light
      'partially_dispatched',  -- some line items shipped, some still in queue
      'dispatched',            -- fully shipped from warehouse
      'delivered',             -- POD captured
      'rejected',              -- approver said no
      'cancelled',             -- voided after approval
      'closed'                 -- everything done, invoiced, paid
    );
  end if;
end $$;

-- ============================================================================
-- rupyz_session — single row, holds the active access + refresh tokens
-- ============================================================================
create table if not exists rupyz_session (
  id                int primary key default 1,
  org_id            int not null,
  user_id           text not null,
  username          text,
  access_token      text not null,
  refresh_token     text not null,
  expires_at        timestamptz not null,
  last_refreshed_at timestamptz default now(),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  constraint singleton check (id = 1)
);

create or replace trigger trg_rupyz_session_updated
  before update on rupyz_session
  for each row execute function set_updated_at();

-- ============================================================================
-- orders — one row per Rupyz order
-- ============================================================================
create table if not exists orders (
  id                  uuid primary key default gen_random_uuid(),

  -- Rupyz identifiers
  rupyz_id            bigint unique not null,        -- 8886470
  rupyz_order_id      text   unique not null,        -- "20260424-86470"

  -- Customer + salesman (nullable — stubbed if Rupyz returns IDs we don't know yet)
  customer_id         uuid references customers(id) on delete restrict,
  rupyz_customer_id   bigint,
  salesman_id         uuid references salesmen(id) on delete set null,
  rupyz_created_by_id bigint,
  rupyz_created_by_name text,

  -- Money
  amount              numeric(14,2) not null,        -- subtotal pre-tax
  gst_amount          numeric(14,2) not null,
  cgst_amount         numeric(14,2) default 0,
  sgst_amount         numeric(14,2) default 0,
  igst_amount         numeric(14,2) default 0,
  discount_amount     numeric(14,2) default 0,
  delivery_charges    numeric(14,2) default 0,
  round_off_amount    numeric(14,2) default 0,
  total_amount        numeric(14,2) not null,

  -- Status — Rupyz mirrors + our app workflow
  rupyz_delivery_status text,                        -- "Received" / "Dispatched" / etc
  rupyz_tally_status    text,                        -- "PENDING" / "DONE"
  app_status            order_app_status not null default 'received',

  -- Payment terms
  payment_option_check    text,                      -- "CREDIT_DAYS" / "ADVANCE"
  remaining_payment_days  int,
  payment_status          text,
  is_paid                 boolean default false,

  -- Delivery address (snapshot — orders don't move once placed)
  delivery_name           text,
  delivery_mobile         text,
  delivery_address_line   text,
  delivery_city           text,
  delivery_state          text,
  delivery_pincode        text,

  -- Misc Rupyz flags
  is_rejected      boolean default false,
  reject_reason    text,
  is_closed        boolean default false,
  is_archived      boolean default false,
  is_telephonic    boolean default false,
  source           text,                             -- "ANDROID" / "WEB"

  -- Refs
  purchase_order_url text,
  comment            text,
  geo_location       text,                           -- "SRID=4326;POINT(...)"

  -- Timestamps from Rupyz
  rupyz_created_at         timestamptz not null,
  rupyz_updated_at         timestamptz not null,
  expected_delivery_date   date,

  -- Our own tracking
  first_seen_at    timestamptz not null default now(),
  last_synced_at   timestamptz not null default now(),
  approved_at      timestamptz,
  approved_by      uuid references app_users(id) on delete set null,
  rejected_at      timestamptz,
  rejected_by      uuid references app_users(id) on delete set null,

  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists orders_app_status_idx       on orders(app_status);
create index if not exists orders_rupyz_delivery_idx   on orders(rupyz_delivery_status);
create index if not exists orders_customer_idx         on orders(customer_id);
create index if not exists orders_salesman_idx         on orders(salesman_id);
create index if not exists orders_rupyz_updated_idx    on orders(rupyz_updated_at desc);
create index if not exists orders_first_seen_idx       on orders(first_seen_at desc);

create or replace trigger trg_orders_updated
  before update on orders
  for each row execute function set_updated_at();

-- ============================================================================
-- order_items — line items per order
-- ============================================================================
create table if not exists order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,

  -- Product link (nullable — stubbed if unknown to us)
  product_id        uuid references products(id) on delete restrict,
  rupyz_product_id  bigint not null,

  -- Snapshot of product info AT order time (immutable history)
  product_name   text not null,
  product_code   text,
  hsn_code       text,
  brand          text,
  category       text,
  unit           text,

  -- Pricing
  qty                       numeric(14,4) not null,
  price                     numeric(14,4) not null,    -- per-unit ex-tax (or as Rupyz reports)
  mrp                       numeric(14,4),
  original_price            numeric(14,4),
  gst_percent               numeric(5,2),
  gst_amount                numeric(14,4),             -- per-unit GST
  total_gst_amount          numeric(14,4),
  total_price               numeric(14,4),             -- line total inc GST
  total_price_without_gst   numeric(14,4),
  discount_value            numeric(14,4) default 0,

  -- Packaging
  packaging_size      numeric(14,4),
  packaging_unit      text,
  measurement_type    text,                            -- "WEIGHT"

  -- Dispatch tracking (Phase 3 fills these in)
  dispatch_qty            numeric(14,4) default 0,    -- pending dispatch
  total_dispatched_qty    numeric(14,4) default 0,    -- cumulative shipped

  -- Full Rupyz item JSON for forensics
  rupyz_raw   jsonb,

  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),

  unique (order_id, rupyz_product_id)                  -- one row per Rupyz product per order
);

create index if not exists order_items_order_idx   on order_items(order_id);
create index if not exists order_items_product_idx on order_items(product_id);

create or replace trigger trg_order_items_updated
  before update on order_items
  for each row execute function set_updated_at();

-- ============================================================================
-- rupyz_sync_log — audit trail of every sync attempt
-- ============================================================================
create table if not exists rupyz_sync_log (
  id                  uuid primary key default gen_random_uuid(),
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text not null,        -- 'running' / 'success' / 'partial' / 'failed'
  trigger             text,                 -- 'cron' / 'manual'
  pages_fetched       int default 0,
  orders_inserted     int default 0,
  orders_updated      int default 0,
  orders_skipped      int default 0,
  customers_stubbed   int default 0,
  products_stubbed    int default 0,
  token_refreshed     boolean default false,
  error_message       text,
  details             jsonb
);

create index if not exists rupyz_sync_log_started_idx on rupyz_sync_log(started_at desc);

-- ============================================================================
-- RLS policies for new tables
-- ============================================================================
alter table orders          enable row level security;
alter table order_items     enable row level security;
alter table rupyz_session   enable row level security;
alter table rupyz_sync_log  enable row level security;

drop policy if exists "read all orders"          on orders;
drop policy if exists "write admin orders"       on orders;
drop policy if exists "write approver orders"    on orders;

create policy "read all orders" on orders
  for select to authenticated using (true);

-- approvers, dispatch, delivery, accounts, admin can all update orders (app_status changes)
create policy "write privileged orders" on orders
  for update to authenticated
  using (exists (
    select 1 from app_users
    where id = auth.uid()
      and active
      and role in ('admin','approver','accounts','dispatch','delivery')
  ))
  with check (exists (
    select 1 from app_users
    where id = auth.uid()
      and active
      and role in ('admin','approver','accounts','dispatch','delivery')
  ));

-- order_items: readable by all authenticated; writes happen via service role from sync function
drop policy if exists "read all order_items" on order_items;
create policy "read all order_items" on order_items
  for select to authenticated using (true);

-- rupyz_session: admin only
drop policy if exists "admin all rupyz_session" on rupyz_session;
create policy "admin all rupyz_session" on rupyz_session
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- rupyz_sync_log: admin only
drop policy if exists "admin all rupyz_sync_log" on rupyz_sync_log;
create policy "admin all rupyz_sync_log" on rupyz_sync_log
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- DONE.
-- Verify with:
--   select count(*) from orders;
--   select count(*) from order_items;
--   select * from rupyz_session;
--   select * from rupyz_sync_log order by started_at desc limit 10;
-- ============================================================================
