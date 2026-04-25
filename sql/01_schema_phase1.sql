-- ============================================================================
-- Rupyz-Tally ERP — Phase 1 schema (masters only)
-- Run this in Supabase → SQL Editor → New Query → Paste → Run.
-- Safe to re-run: everything uses IF NOT EXISTS / CREATE OR REPLACE.
-- ============================================================================

-- ---- Extensions ------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;          -- fuzzy text search on names

-- ---- Enums -----------------------------------------------------------------
do $$ begin
  create type user_role as enum (
    'admin', 'approver', 'accounts', 'dispatch', 'delivery', 'salesman'
  );
exception when duplicate_object then null; end $$;

-- ---- Shared: updated_at trigger fn ----------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================================
-- 1. SALESMEN  (5 seeded rows — Ganesh, Raju, Gopal, Akshay, Radhe)
-- ============================================================================
create table if not exists salesmen (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  phone           text not null unique,           -- stored as 91XXXXXXXXXX (12 digits, no + or -)
  email           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_salesmen_updated on salesmen;
create trigger trg_salesmen_updated before update on salesmen
  for each row execute function set_updated_at();

-- ============================================================================
-- 2. BEATS  (routes — derived from Rupyz export; 26 distinct beats)
-- ============================================================================
create table if not exists beats (
  id              uuid primary key default uuid_generate_v4(),
  rupyz_code      text unique,                    -- e.g. BP2512169049247
  name            text not null,
  city            text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_beats_updated on beats;
create trigger trg_beats_updated before update on beats
  for each row execute function set_updated_at();

-- ============================================================================
-- 3. CATEGORIES  (all 43 SKUs are "Tea" today — future-proof)
-- ============================================================================
create table if not exists categories (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null unique,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- 4. BRANDS  (10 brands in export)
-- ============================================================================
create table if not exists brands (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null unique,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- 5. PRODUCTS  (SKU master — 43 rows from Rupyz)
--    "Add Product" UI will insert here; rupyz_code = null for manually added.
-- ============================================================================
create table if not exists products (
  id                      uuid primary key default uuid_generate_v4(),
  rupyz_code              text unique,                   -- null for manually added
  name                    text not null,
  category_id             uuid references categories(id) on delete restrict,
  brand_id                uuid references brands(id) on delete restrict,
  mrp                     numeric(12,2) not null,
  base_price              numeric(12,2) not null,         -- default selling price
  unit                    text not null,                  -- Kg / Packet
  measurement_type        text,                           -- WEIGHT
  unit_of_measurement     text,                           -- Kilogram
  gst_percent             numeric(5,2) not null default 5,
  hsn_code                text,
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id),
  updated_by              uuid references auth.users(id)
);
drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

-- ============================================================================
-- 6. CUSTOMERS  (Customer master — 1,097 rows from Rupyz)
--    salesman_id stays null on import; populated from first order or manually.
--    gstin stays null on import; filled when we sync Tally ledger.
-- ============================================================================
create table if not exists customers (
  id              uuid primary key default uuid_generate_v4(),
  rupyz_code      text unique,                            -- null for manually added
  name            text not null,
  customer_level  text,                                   -- Primary / Secondary Customer
  customer_type   text,                                   -- Retailer / Wholesaler
  mobile          text,                                   -- 91XXXXXXXXXX
  salesman_id     uuid references salesmen(id) on delete set null,
  gstin           text,                                   -- from Tally later
  address         text,
  city            text,
  pincode         text,
  beat_id         uuid references beats(id) on delete set null,
  map_address     text,
  latitude        numeric(10,6),
  longitude       numeric(11,6),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id)
);
drop trigger if exists trg_customers_updated on customers;
create trigger trg_customers_updated before update on customers
  for each row execute function set_updated_at();

-- ============================================================================
-- 7. APP_USERS  (10 ERP users — 1:1 with Supabase auth.users)
-- ============================================================================
create table if not exists app_users (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null,
  email           text not null unique,
  phone           text,
  role            user_role not null,
  salesman_id     uuid references salesmen(id) on delete set null,  -- only for salesman-role users
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists trg_app_users_updated on app_users;
create trigger trg_app_users_updated before update on app_users
  for each row execute function set_updated_at();

-- ============================================================================
-- INDEXES  (covers the most common query patterns)
-- ============================================================================
create index if not exists idx_customers_beat     on customers(beat_id);
create index if not exists idx_customers_salesman on customers(salesman_id);
create index if not exists idx_customers_active   on customers(active) where active = true;
create index if not exists idx_customers_name_trgm    on customers using gin (name gin_trgm_ops);
create index if not exists idx_customers_mobile   on customers(mobile);
create index if not exists idx_products_brand     on products(brand_id);
create index if not exists idx_products_category  on products(category_id);
create index if not exists idx_products_active    on products(active) where active = true;
create index if not exists idx_products_name_trgm     on products using gin (name gin_trgm_ops);

-- ============================================================================
-- ROW LEVEL SECURITY  (enable now; policies added once auth wired up)
-- ============================================================================
alter table salesmen   enable row level security;
alter table beats      enable row level security;
alter table categories enable row level security;
alter table brands     enable row level security;
alter table products   enable row level security;
alter table customers  enable row level security;
alter table app_users  enable row level security;

-- Temporary: authenticated users can read everything. Write policies come with Phase 1.5 (auth).
create policy "authenticated read salesmen"   on salesmen   for select to authenticated using (true);
create policy "authenticated read beats"      on beats      for select to authenticated using (true);
create policy "authenticated read categories" on categories for select to authenticated using (true);
create policy "authenticated read brands"     on brands     for select to authenticated using (true);
create policy "authenticated read products"   on products   for select to authenticated using (true);
create policy "authenticated read customers"  on customers  for select to authenticated using (true);
create policy "authenticated read own profile" on app_users for select to authenticated using (id = auth.uid());

-- ============================================================================
-- SEED SALESMEN  (idempotent)
-- ============================================================================
insert into salesmen (name, phone) values
  ('Ganesh Ankwar',     '917385000101'),
  ('Raju Dhoke',        '919518589390'),
  ('Gopal Chintal',     '919175260955'),
  ('Akshay Lidhoriye',  '919860748060'),
  ('Radhe Suram',       '919422017060')
on conflict (phone) do nothing;

-- Done. Verify with:
--   select count(*) from salesmen;   -- expect 5
--   select count(*) from products;   -- expect 0 (import script loads these)
--   select count(*) from customers;  -- expect 0
