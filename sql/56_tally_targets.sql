-- =============================================================================
-- 56_tally_targets.sql
--
-- STANDALONE target system based on Tally sales data (independent of the Rupyz
-- order data and the journey-cycle distribute flow). Three tables + one RPC.
--
--   tally_sales            imported Tally line-items (refreshed from Google Sheet)
--   tally_beat_targets     per party-group (beat) kg target for a named period
--   tally_customer_targets derived per-party (shop) kg target + editable share
--   tally_group_shares()   RPC: each shop's kg + share% within a party group
--
-- Grouping: beat = "Party Group" column, shop = "Party Name" column.
-- Unit: kg (from the "Qty (Kg)" column).
-- =============================================================================

-- ---- Raw imported sales ----------------------------------------------------
create table if not exists tally_sales (
  id            bigint generated always as identity primary key,
  sale_date     date,
  voucher_no    text,
  party_name    text not null,
  item          text,
  qty           numeric,
  rate          numeric,
  amount        numeric,
  qty_kg        numeric,
  party_group   text,            -- the "beat"
  root_group    text,            -- Primary / Sundry Creditors etc.
  guid          text,
  alter_id      text,
  source_row    int,             -- line number in the sheet, for debugging
  imported_at   timestamptz not null default now()
);
create index if not exists idx_tally_sales_group on tally_sales(party_group);
create index if not exists idx_tally_sales_party on tally_sales(party_name);
create index if not exists idx_tally_sales_date  on tally_sales(sale_date);

-- ---- Beat (party-group) targets --------------------------------------------
create table if not exists tally_beat_targets (
  id            uuid primary key default gen_random_uuid(),
  party_group   text not null,
  period_label  text not null,          -- free-form, e.g. "May 2026" or "JC2"
  target_kg     numeric not null check (target_kg >= 0),
  created_by    uuid references app_users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (party_group, period_label)
);

-- ---- Customer (party) targets ----------------------------------------------
create table if not exists tally_customer_targets (
  id              uuid primary key default gen_random_uuid(),
  beat_target_id  uuid not null references tally_beat_targets(id) on delete cascade,
  party_name      text not null,
  share_pct       numeric not null default 0 check (share_pct >= 0),
  target_kg       numeric not null default 0 check (target_kg >= 0),
  hist_kg         numeric not null default 0,
  created_at      timestamptz not null default now(),
  unique (beat_target_id, party_name)
);
create index if not exists idx_tally_cust_targets_bt on tally_customer_targets(beat_target_id);

-- ---- Share RPC -------------------------------------------------------------
-- Each shop's total kg within a party group over an optional date window, plus
-- their share% of the group total. Window null = all-time.
create or replace function tally_group_shares(
  p_party_group text,
  p_from date default null,
  p_to   date default null
)
returns table(
  party_name text,
  hist_kg    numeric,
  share_pct  numeric
)
language sql stable as $$
  with rows as (
    select party_name, coalesce(sum(qty_kg),0) as kg
    from tally_sales
    where party_group = p_party_group
      and (p_from is null or sale_date >= p_from)
      and (p_to   is null or sale_date <= p_to)
    group by party_name
  ),
  tot as (select nullif(sum(kg),0) as total from rows)
  select
    r.party_name,
    round(r.kg, 2) as hist_kg,
    round(case when t.total is null then 0 else 100.0 * r.kg / t.total end, 4) as share_pct
  from rows r cross join tot t
  order by r.kg desc, r.party_name;
$$;

grant execute on function tally_group_shares(text, date, date) to authenticated;

-- ---- List of party groups (for the picker) ---------------------------------
create or replace function tally_party_groups()
returns table(party_group text, root_group text, parties bigint, total_kg numeric)
language sql stable as $$
  select party_group,
         max(root_group) as root_group,
         count(distinct party_name) as parties,
         round(coalesce(sum(qty_kg),0),1) as total_kg
  from tally_sales
  where party_group is not null
  group by party_group
  order by total_kg desc;
$$;

grant execute on function tally_party_groups() to authenticated;

-- ---- updated_at trigger ----------------------------------------------------
create or replace function touch_tally_beat_targets()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_tally_bt_touch on tally_beat_targets;
create trigger trg_tally_bt_touch before update on tally_beat_targets
  for each row execute function touch_tally_beat_targets();

-- ---- RLS -------------------------------------------------------------------
alter table tally_sales enable row level security;
alter table tally_beat_targets enable row level security;
alter table tally_customer_targets enable row level security;
drop policy if exists tally_sales_read on tally_sales;
create policy tally_sales_read on tally_sales for select using (auth.role() = 'authenticated');
drop policy if exists tally_bt_read on tally_beat_targets;
create policy tally_bt_read on tally_beat_targets for select using (auth.role() = 'authenticated');
drop policy if exists tally_ct_read on tally_customer_targets;
create policy tally_ct_read on tally_customer_targets for select using (auth.role() = 'authenticated');

-- =============================================================================
-- After running this, load data via the refresh endpoint (/api/tally-targets/refresh)
-- OR the seed file 56b_tally_seed.sql for an immediate snapshot.
-- =============================================================================
