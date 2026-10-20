-- =============================================================================
-- One-shot loader: Anjali Agency FY26-27 sales invoices into the ERP's
-- Supabase project (aiekaymlbfypxnczrvgb).
--
-- Fetches via pg_net HTTP from tally-dashboard-v2's public views:
--   https://zrdvmgxnmcqnxvlitonz.supabase.co/rest/v1/v_anjali_fy26_27_vouchers
--   https://zrdvmgxnmcqnxvlitonz.supabase.co/rest/v1/v_anjali_fy26_27_lines
--
-- Expected result: 1,735 invoice headers + 5,983 line items. ~₹5.54 Cr value,
-- ~148,588 kg weight, 365 distinct parties.
--
-- Run this in the Supabase SQL editor for project aiekaymlbfypxnczrvgb.
--
-- Reversal:
--   delete from public.tally_invoice_lines where invoice_id in (
--     select id from public.tally_invoices
--     where company='Anjali Agency' and imported_at::date = '2026-10-20');
--   delete from public.tally_invoices
--   where company='Anjali Agency' and imported_at::date = '2026-10-20';
-- =============================================================================

-- Step 1: extensions
create extension if not exists http;
create extension if not exists pg_net;

-- Step 2: tables
create table if not exists public.tally_invoices (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  voucher_type text,
  voucher_no text,
  voucher_date date not null,
  party_name text,
  party_group text,
  party_gstin text,
  total_amount numeric,
  cgst numeric,
  sgst numeric,
  igst numeric,
  round_off numeric,
  source_voucher_id uuid unique,
  fin_year text,
  imported_at timestamptz default now()
);
create index if not exists tally_invoices_company_date_idx on public.tally_invoices (company, voucher_date);
create index if not exists tally_invoices_party_idx on public.tally_invoices (party_name);

create table if not exists public.tally_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.tally_invoices(id) on delete cascade,
  source_voucher_id uuid,
  line_no integer,
  item_name text,
  stock_group text,
  hsn text,
  qty numeric,
  qty_kg numeric,
  qty_raw_text text,
  rate numeric,
  amount numeric
);
create index if not exists tally_invoice_lines_invoice_idx on public.tally_invoice_lines (invoice_id);
create index if not exists tally_invoice_lines_source_idx on public.tally_invoice_lines (source_voucher_id);

-- Step 3: loader functions
create or replace function _load_anjali_headers()
returns table(total_fetched int, total_inserted int) as $fn$
declare
  v_offset int := 0;
  v_batch int := 1000;
  v_body jsonb;
  v_count int;
  v_fetched int := 0;
  v_inserted int := 0;
  v_response_count int;
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyZHZtZ3hubWNxbnh2bGl0b256Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDc4NzQsImV4cCI6MjA5NjA4Mzg3NH0.nSkBb0MaRu3lLN8Zu7B1L8v8qhdFleeOL0tYzPYu1po';
  v_batch_imported_at timestamptz := now();
begin
  loop
    select content::jsonb into v_body
    from http((
      'GET',
      format('https://zrdvmgxnmcqnxvlitonz.supabase.co/rest/v1/v_anjali_fy26_27_vouchers?limit=%s&offset=%s&order=voucher_date,voucher_no', v_batch, v_offset),
      ARRAY[
        http_header('apikey', v_anon_key),
        http_header('Authorization', 'Bearer ' || v_anon_key),
        http_header('Accept', 'application/json')
      ],
      null, null
    )::http_request);

    if v_body is null then exit; end if;
    v_response_count := jsonb_array_length(v_body);
    if v_response_count = 0 then exit; end if;
    v_fetched := v_fetched + v_response_count;

    with ins as (
      insert into public.tally_invoices (
        source_voucher_id, company, voucher_type, voucher_no, voucher_date,
        party_name, party_group, party_gstin, total_amount, cgst, sgst, igst, round_off,
        fin_year, imported_at
      )
      select
        (r->>'source_voucher_id')::uuid,
        'Anjali Agency',
        r->>'voucher_type',
        r->>'voucher_no',
        (r->>'voucher_date')::date,
        r->>'party_name',
        r->>'party_group',
        r->>'party_gstin',
        nullif(r->>'total_amount','')::numeric,
        nullif(r->>'cgst','')::numeric,
        nullif(r->>'sgst','')::numeric,
        nullif(r->>'igst','')::numeric,
        nullif(r->>'round_off','')::numeric,
        '2026-27',
        v_batch_imported_at
      from jsonb_array_elements(v_body) as r
      on conflict (source_voucher_id) do nothing
      returning 1
    )
    select count(*) into v_count from ins;
    v_inserted := v_inserted + v_count;

    if v_response_count < v_batch then exit; end if;
    v_offset := v_offset + v_batch;
  end loop;

  return query select v_fetched, v_inserted;
end;
$fn$ language plpgsql;

create or replace function _load_anjali_lines()
returns table(total_fetched int, total_inserted int) as $fn$
declare
  v_offset int := 0;
  v_batch int := 1000;
  v_body jsonb;
  v_count int;
  v_fetched int := 0;
  v_inserted int := 0;
  v_response_count int;
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyZHZtZ3hubWNxbnh2bGl0b256Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDc4NzQsImV4cCI6MjA5NjA4Mzg3NH0.nSkBb0MaRu3lLN8Zu7B1L8v8qhdFleeOL0tYzPYu1po';
begin
  loop
    select content::jsonb into v_body
    from http((
      'GET',
      format('https://zrdvmgxnmcqnxvlitonz.supabase.co/rest/v1/v_anjali_fy26_27_lines?limit=%s&offset=%s&order=source_voucher_id,line_no', v_batch, v_offset),
      ARRAY[
        http_header('apikey', v_anon_key),
        http_header('Authorization', 'Bearer ' || v_anon_key),
        http_header('Accept', 'application/json')
      ],
      null, null
    )::http_request);

    if v_body is null then exit; end if;
    v_response_count := jsonb_array_length(v_body);
    if v_response_count = 0 then exit; end if;
    v_fetched := v_fetched + v_response_count;

    with ins as (
      insert into public.tally_invoice_lines (
        invoice_id, source_voucher_id, line_no, item_name, stock_group, hsn,
        qty, qty_kg, qty_raw_text, rate, amount
      )
      select
        ti.id,
        (r->>'source_voucher_id')::uuid,
        nullif(r->>'line_no','')::int,
        r->>'item_name',
        r->>'stock_group',
        r->>'hsn',
        nullif(r->>'qty','')::numeric,
        nullif(r->>'qty_kg','')::numeric,
        r->>'qty_raw_text',
        nullif(r->>'rate','')::numeric,
        nullif(r->>'amount','')::numeric
      from jsonb_array_elements(v_body) as r
      join public.tally_invoices ti on ti.source_voucher_id = (r->>'source_voucher_id')::uuid
      returning 1
    )
    select count(*) into v_count from ins;
    v_inserted := v_inserted + v_count;

    if v_response_count < v_batch then exit; end if;
    v_offset := v_offset + v_batch;
  end loop;

  return query select v_fetched, v_inserted;
end;
$fn$ language plpgsql;

-- Step 4: run the loaders
select * from _load_anjali_headers();  -- expect 1735 / 1735
select * from _load_anjali_lines();    -- expect 5983 / 5983

-- Step 5: verify
select
  (select count(*) from public.tally_invoices where company='Anjali Agency') as headers,
  (select count(*) from public.tally_invoice_lines) as lines,
  (select count(distinct party_name) from public.tally_invoices where company='Anjali Agency') as parties,
  (select min(voucher_date) from public.tally_invoices where company='Anjali Agency') as earliest,
  (select max(voucher_date) from public.tally_invoices where company='Anjali Agency') as latest,
  (select round(sum(total_amount)) from public.tally_invoices where company='Anjali Agency') as total_value,
  (select round(sum(qty_kg)) from public.tally_invoice_lines) as total_kg;

-- Step 6: clean up loader functions
drop function if exists _load_anjali_headers();
drop function if exists _load_anjali_lines();
