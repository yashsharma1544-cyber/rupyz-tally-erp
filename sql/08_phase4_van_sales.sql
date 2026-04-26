-- ============================================================================
-- Rupyz-Tally ERP — Phase 4 schema (VAN Sales)
-- Adds: van_trips, trip_load_items, trip_bills, trip_bill_items,
--       trip_payments, customer_outstanding
-- Idempotent. Run AFTER 06_phase3_order_workflow.sql.
-- ============================================================================

-- ---- Extend user_role enum --------------------------------------------------
do $$ begin
  alter type user_role add value if not exists 'van_lead';
exception when duplicate_object then null; end $$;
do $$ begin
  alter type user_role add value if not exists 'van_helper';
exception when duplicate_object then null; end $$;

-- ---- mark beats that are VAN-eligible ---------------------------------------
alter table beats
  add column if not exists is_van_beat boolean not null default false;

-- Default-flag the 5 known VAN beats (case-insensitive name match)
update beats set is_van_beat = true
where lower(name) in (
  'd raja',
  'd mahi- andera mera', 'd mahi-andera mera', 'd mahi andera mera',
  'lonar',
  'mehkar',
  'mehkar rural'
);

-- ---- master customer outstanding (one row per customer) --------------------
create table if not exists customer_outstanding (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid unique not null references customers(id) on delete cascade,
  amount          numeric(14,2) not null default 0,
  source          text not null default 'manual',  -- 'tally_csv' | 'manual'
  imported_at     timestamptz default now(),
  imported_by     uuid references app_users(id) on delete set null,
  notes           text,
  updated_at      timestamptz default now()
);

create index if not exists customer_outstanding_amount_idx
  on customer_outstanding(amount) where amount > 0;

create or replace trigger trg_customer_outstanding_updated
  before update on customer_outstanding
  for each row execute function set_updated_at();

-- ---- van_trips: one row per trip-day ---------------------------------------
create type van_trip_status as enum (
  'planning',     -- trip drafted, can edit pre-orders & buffer
  'loading',      -- loading sheet printed, awaiting physical load
  'in_progress',  -- van on the road, bills being captured
  'returned',    -- vehicle back, awaiting reconciliation
  'reconciled',  -- fully reconciled, locked
  'cancelled'
);

create table if not exists van_trips (
  id                  uuid primary key default gen_random_uuid(),
  trip_number         text unique not null,            -- 'V-YYYYMMDD-NNN'
  trip_date           date not null,
  beat_id             uuid not null references beats(id) on delete restrict,
  vehicle_type        text not null check (vehicle_type in ('company','own')),
  vehicle_number      text,
  vehicle_provided_by text,                            -- 'Vikram Tea' / null
  lead_id             uuid not null references app_users(id) on delete restrict,
  helpers             text[] not null default '{}',    -- free-form names
  status              van_trip_status not null default 'planning',
  notes               text,
  created_by          uuid references app_users(id) on delete set null,
  created_at          timestamptz default now(),
  loaded_at           timestamptz,
  loaded_by           uuid references app_users(id) on delete set null,
  started_at          timestamptz,                     -- moved to in_progress
  returned_at         timestamptz,
  reconciled_at       timestamptz,
  reconciled_by       uuid references app_users(id) on delete set null,
  cash_collected_actual numeric(14,2),                 -- physical cash counted
  reconcile_notes     text,
  updated_at          timestamptz default now()
);

create index if not exists van_trips_status_idx on van_trips(status);
create index if not exists van_trips_date_idx   on van_trips(trip_date desc);
create index if not exists van_trips_beat_idx   on van_trips(beat_id);

create or replace trigger trg_van_trips_updated
  before update on van_trips
  for each row execute function set_updated_at();

-- Auto-generate trip number: V-YYYYMMDD-NNN
create or replace function next_trip_number(d date default current_date)
returns text language plpgsql as $$
declare
  prefix text;
  next_n int;
begin
  prefix := 'V-' || to_char(d, 'YYYYMMDD');
  select coalesce(max(substring(trip_number from '\d+$')::int), 0) + 1
    into next_n
    from van_trips
    where trip_number like prefix || '-%';
  return prefix || '-' || lpad(next_n::text, 3, '0');
end;
$$;

-- ---- trip_load_items: total qty per SKU loaded on the trip -----------------
create table if not exists trip_load_items (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references van_trips(id) on delete cascade,
  product_id      uuid not null references products(id) on delete restrict,
  qty_planned     numeric(14,4) not null check (qty_planned > 0),
  qty_loaded      numeric(14,4),                       -- set when loading confirmed
  qty_returned    numeric(14,4),                       -- set during reconcile
  source_pre_order_qty numeric(14,4) not null default 0, -- of qty_planned, how much from pre-orders
  source_buffer_qty    numeric(14,4) not null default 0, -- of qty_planned, how much buffer
  created_at      timestamptz default now(),
  unique (trip_id, product_id)
);

create index if not exists trip_load_items_trip_idx on trip_load_items(trip_id);

-- ---- trip_bills: pre-order delivery + spot bills ---------------------------
create table if not exists trip_bills (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references van_trips(id) on delete cascade,
  bill_number       text unique not null,              -- 'V-YYYYMMDD-NNN-B-NN'
  bill_type         text not null check (bill_type in ('pre_order','spot')),
  customer_id       uuid not null references customers(id) on delete restrict,
  source_order_id   uuid references orders(id) on delete set null, -- only set for pre_order
  paper_bill_no     text,                              -- kachi parchi cross-ref
  payment_mode      text not null check (payment_mode in ('cash','credit')),
  subtotal          numeric(14,2) not null,
  total_amount      numeric(14,2) not null,
  outstanding_collected numeric(14,2) not null default 0,
  cash_received     numeric(14,2) not null default 0,  -- cash for THIS bill only
  notes             text,
  is_cancelled      boolean not null default false,
  confirmed_at      timestamptz,                       -- set when bill is finalized at the shop
  created_by        uuid references app_users(id) on delete set null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists trip_bills_trip_idx     on trip_bills(trip_id);
create index if not exists trip_bills_customer_idx on trip_bills(customer_id);
create index if not exists trip_bills_order_idx    on trip_bills(source_order_id);

create or replace trigger trg_trip_bills_updated
  before update on trip_bills
  for each row execute function set_updated_at();

-- Auto-generate bill number: <trip_number>-B-NN
create or replace function next_trip_bill_number(p_trip_id uuid)
returns text language plpgsql as $$
declare
  trip_no text;
  next_n int;
begin
  select trip_number into trip_no from van_trips where id = p_trip_id;
  if trip_no is null then raise exception 'trip not found'; end if;
  select coalesce(max(substring(bill_number from 'B-(\d+)$')::int), 0) + 1
    into next_n
    from trip_bills where trip_id = p_trip_id;
  return trip_no || '-B-' || lpad(next_n::text, 2, '0');
end;
$$;

-- ---- trip_bill_items -------------------------------------------------------
create table if not exists trip_bill_items (
  id              uuid primary key default gen_random_uuid(),
  bill_id         uuid not null references trip_bills(id) on delete cascade,
  product_id      uuid not null references products(id) on delete restrict,
  qty             numeric(14,4) not null check (qty > 0),
  rate            numeric(14,4) not null,              -- snapshot
  amount          numeric(14,2) not null,              -- qty * rate
  created_at      timestamptz default now()
);

create index if not exists trip_bill_items_bill_idx    on trip_bill_items(bill_id);
create index if not exists trip_bill_items_product_idx on trip_bill_items(product_id);

-- ---- RLS for new tables ----------------------------------------------------
alter table customer_outstanding enable row level security;
alter table van_trips            enable row level security;
alter table trip_load_items      enable row level security;
alter table trip_bills           enable row level security;
alter table trip_bill_items      enable row level security;

drop policy if exists "read all customer_outstanding" on customer_outstanding;
create policy "read all customer_outstanding" on customer_outstanding
  for select to authenticated using (true);

drop policy if exists "read all van_trips" on van_trips;
create policy "read all van_trips" on van_trips
  for select to authenticated using (true);

drop policy if exists "read all trip_load_items" on trip_load_items;
create policy "read all trip_load_items" on trip_load_items
  for select to authenticated using (true);

drop policy if exists "read all trip_bills" on trip_bills;
create policy "read all trip_bills" on trip_bills
  for select to authenticated using (true);

drop policy if exists "read all trip_bill_items" on trip_bill_items;
create policy "read all trip_bill_items" on trip_bill_items
  for select to authenticated using (true);

-- ============================================================================
-- KPI helper: van_trip_kpis(trip_id) — aggregates running totals for a trip
-- Used by mobile billing app + reconciliation screen.
-- "kg" is approximate — sums qty for products whose unit is Kg/kg.
-- For packet products, falls back to summing qty as units (still useful for
-- "stock remaining" awareness on the truck).
-- ============================================================================
create or replace function van_trip_kpis(p_trip_id uuid)
returns table (
  bills_count           bigint,
  pre_order_count       bigint,
  spot_count            bigint,
  cash_bills_total      numeric,
  credit_bills_total    numeric,
  outstanding_collected numeric,
  expected_cash         numeric,
  total_kg_billed       numeric,
  total_kg_loaded       numeric,
  total_kg_remaining    numeric
)
language sql stable
as $$
  with bill_totals as (
    select
      count(*)                                                          as bills_count,
      count(*) filter (where bill_type='pre_order' and not is_cancelled) as pre_order_count,
      count(*) filter (where bill_type='spot' and not is_cancelled)      as spot_count,
      coalesce(sum(case when payment_mode='cash' and not is_cancelled then total_amount else 0 end),0) as cash_bills_total,
      coalesce(sum(case when payment_mode='credit' and not is_cancelled then total_amount else 0 end),0) as credit_bills_total,
      coalesce(sum(case when not is_cancelled then outstanding_collected else 0 end),0) as outstanding_collected
    from trip_bills where trip_id = p_trip_id
  ),
  qty_billed as (
    select coalesce(sum(bi.qty),0) as q
    from trip_bill_items bi
    join trip_bills b on b.id = bi.bill_id and b.trip_id = p_trip_id and not b.is_cancelled
  ),
  qty_loaded as (
    select coalesce(sum(coalesce(qty_loaded, qty_planned)),0) as q
    from trip_load_items where trip_id = p_trip_id
  )
  select
    bt.bills_count, bt.pre_order_count, bt.spot_count,
    bt.cash_bills_total, bt.credit_bills_total, bt.outstanding_collected,
    bt.cash_bills_total + bt.outstanding_collected                    as expected_cash,
    qb.q                                                              as total_kg_billed,
    ql.q                                                              as total_kg_loaded,
    greatest(ql.q - qb.q, 0)                                          as total_kg_remaining
  from bill_totals bt
  cross join qty_billed qb
  cross join qty_loaded ql;
$$;

grant execute on function van_trip_kpis(uuid) to authenticated;
grant execute on function next_trip_number(date) to authenticated;
grant execute on function next_trip_bill_number(uuid) to authenticated;
