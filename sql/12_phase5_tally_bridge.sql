-- ============================================================================
-- 12 — Phase 5 chunk 1: Tally bridge foundation (pull-only)
--
-- Tables for data pulled FROM Tally Prime via the local agent. The agent
-- queries Tally over HTTP/XML, parses the response, and POSTs to our app's
-- /api/tally/ingest endpoint. We never push to Tally.
--
-- This chunk introduces only the OUTSTANDING table; receipts and stock will
-- come in chunk 2. The agent's secret is stored in app_settings.
--
-- Safe to re-run.
-- ============================================================================


-- ---- app_settings: small key-value store (used for agent secret) -----------
create table if not exists app_settings (
  key             text primary key,
  value           text,
  updated_at      timestamptz default now()
);

create or replace trigger trg_app_settings_updated
  before update on app_settings
  for each row execute function set_updated_at();


-- ---- tally_outstanding: customer balances pulled from Tally ----------------
-- This table mirrors customer_outstanding but is exclusively for Tally-sourced
-- data. Once chunk 3 ships and Tally is the source of truth, we can deprecate
-- the legacy customer_outstanding rows where source='tally_csv'.
create table if not exists tally_outstanding (
  id                  uuid primary key default gen_random_uuid(),
  -- Source data from Tally
  ledger_name         text not null,
  ledger_guid         text,                  -- Tally's GUID, if available; useful as stable id
  ledger_parent       text,                  -- e.g. "Sundry Debtors"
  ledger_state        text,                  -- e.g. "Madhya Pradesh"
  ledger_pincode      text,
  ledger_mobile       text,
  ledger_gstin        text,
  amount              numeric(14,2) not null,  -- positive = customer owes us
  raw_balance         numeric(14,2),           -- Tally's signed value (negative for credit balances)
  -- Match to our customer
  customer_id         uuid references customers(id) on delete set null,
  match_method        text,    -- 'name_exact' | 'name_fuzzy' | 'mobile' | 'gstin' | 'unmatched'
  match_score         numeric(4,3),  -- 0..1, only relevant for fuzzy matches
  -- Bookkeeping
  synced_at           timestamptz default now(),
  unique (ledger_name)
);

create index if not exists tally_outstanding_customer_idx on tally_outstanding(customer_id);
create index if not exists tally_outstanding_amount_idx on tally_outstanding(amount) where amount > 0;
create index if not exists tally_outstanding_mobile_idx on tally_outstanding(ledger_mobile) where ledger_mobile is not null;
create index if not exists tally_outstanding_match_idx on tally_outstanding(match_method);


-- ---- tally_sync_log: history of agent runs ---------------------------------
-- Mirrors rupyz_sync_log shape so the UI can present them similarly.
create table if not exists tally_sync_log (
  id                       uuid primary key default gen_random_uuid(),
  started_at               timestamptz default now(),
  finished_at              timestamptz,
  status                   text not null default 'running',  -- 'running' | 'success' | 'failed'
  trigger                  text,                              -- 'manual' | 'scheduled'
  -- Counters
  outstanding_synced       int default 0,
  outstanding_matched      int default 0,
  outstanding_unmatched    int default 0,
  receipts_synced          int default 0,                     -- chunk 2
  stock_synced             int default 0,                     -- chunk 2
  -- Diagnostics
  error_message            text,
  details                  jsonb
);

create index if not exists tally_sync_log_started_idx on tally_sync_log(started_at desc);


-- ---- RLS policies (read-only for app users) --------------------------------
alter table tally_outstanding enable row level security;
alter table tally_sync_log enable row level security;
alter table app_settings enable row level security;

-- Tally outstanding: any authenticated app user can read; writes only via service role
drop policy if exists tally_outstanding_read on tally_outstanding;
create policy tally_outstanding_read on tally_outstanding
  for select using (
    exists (select 1 from app_users where id = auth.uid() and active = true)
  );

drop policy if exists tally_sync_log_read on tally_sync_log;
create policy tally_sync_log_read on tally_sync_log
  for select using (
    exists (select 1 from app_users where id = auth.uid() and active = true)
  );

-- app_settings: admin only (it holds the agent secret; non-admin should not see)
drop policy if exists app_settings_admin_all on app_settings;
create policy app_settings_admin_all on app_settings
  for all using (
    exists (select 1 from app_users where id = auth.uid() and active = true and role = 'admin')
  );


-- ---- Comments / documentation ---------------------------------------------
comment on table tally_outstanding is 'Customer outstanding balances pulled from Tally Prime via the local agent. Updated on each sync.';
comment on column tally_outstanding.amount is 'Positive amount that the customer owes us. Computed as -raw_balance for Sundry Debtors.';
comment on column tally_outstanding.raw_balance is 'Tally CLOSINGBALANCE as-is. Customers (Sundry Debtors) appear as negative; we flip the sign in `amount`.';

comment on table tally_sync_log is 'History of Tally agent sync runs. Mirrors rupyz_sync_log shape.';
comment on table app_settings is 'Generic key-value store. Currently holds tally_agent_secret. Admin-only RLS.';
