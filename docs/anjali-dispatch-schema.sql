-- =============================================================================
-- Dispatch + delivery tracking schema for Out-for-Delivery (Anjali Tally invoices)
--
-- Adds:
--   - Status columns on tally_invoices (dispatched_at, delivered_at, dispatch_id,
--     delivered_by, inferred_beat)
--   - tally_dispatches table (one row per vehicle load — groups invoices)
--   - _infer_beat_from_party_name() — regex-based beat inference from the
--     Anjali party-name conventions ("Govind Kirana (S Pur)" → S Pur, etc.)
--
-- Idempotent: safe to re-run.
--
-- Run in Supabase SQL editor for project aiekaymlbfypxnczrvgb AFTER
-- docs/anjali-load.sql (needs tally_invoices to exist).
-- =============================================================================

-- Status + dispatch columns
alter table public.tally_invoices
  add column if not exists dispatched_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_by uuid,
  add column if not exists dispatch_id uuid,
  add column if not exists inferred_beat text,
  add column if not exists delivery_notes text;

-- Dispatch groups (one vehicle load, one driver, one day)
create table if not exists public.tally_dispatches (
  id uuid primary key default gen_random_uuid(),
  dispatch_no text,
  dispatch_date date not null default current_date,
  vehicle_id uuid,
  vehicle_number text,
  driver_user_id uuid,
  driver_name text,
  notes text,
  created_at timestamptz default now(),
  created_by uuid,
  created_by_name text,
  completed_at timestamptz,
  invoice_count integer default 0,
  total_amount numeric default 0,
  total_kg numeric default 0
);

create index if not exists tally_dispatches_date_idx on public.tally_dispatches (dispatch_date desc);
create index if not exists tally_invoices_dispatch_idx on public.tally_invoices (dispatch_id) where dispatch_id is not null;
create index if not exists tally_invoices_beat_idx on public.tally_invoices (inferred_beat);
create index if not exists tally_invoices_status_pending_idx on public.tally_invoices (voucher_date desc) where delivered_at is null;

-- Beat inference from Anjali party-name conventions
create or replace function public._infer_beat_from_party_name(p_name text)
returns text as $$
declare
  n text := upper(coalesce(p_name, ''));
begin
  if n = '' then return 'Unassigned'; end if;
  if n like '%SUSHIL AGENCIES%' then return 'Internal'; end if;
  if n ~ 'S\s*\.?\s*PUR|SPUR' then return 'S Pur'; end if;
  if n ~ 'D\s*\.?\s*RAJA|DRAJA|D\s*\.?\s*R\s*\.' then return 'D Raja'; end if;
  if n ~ 'MEHKAR' then return 'Mehkar'; end if;
  if n ~ 'LONAR' then return 'Lonar'; end if;
  if n ~ 'D\s*\.?\s*MALI|DEULGAON MALI' then return 'Deulgaon Mali'; end if;
  if n ~ 'HIWRA|H\s*\.?\s*ASHRAM' then return 'Hiwra Ashram'; end if;
  if n ~ 'S\s*\.?\s*KHEDA|SAKHARKHEDA' then return 'Sakharkheda'; end if;
  if n ~ 'D\s*\.?\s*MAHI|ANDHERA|\(ANDERA|\sANDERA|\(MERA|\sMERA\s|SWAMISAMRTHA' then return 'D Mahi-Andera-Mera'; end if;
  if n ~ 'MALIPETH|JAVLE|M\.D\.\s*WARADE' then return 'Malipeth'; end if;
  if n ~ 'WAGHRUL' then return 'Waghrul'; end if;
  if n ~ 'TALNI' then return 'Talni'; end if;
  if n ~ 'B\s*PUR|BAMBU|SADHUBHA' then return 'B Pur / Bambu'; end if;
  if n ~ 'NEW\s*MONDHA|N\.?\s*MONDHA|N\.M\.|NMONDHA' then return 'New Mondha'; end if;
  if n ~ 'ANTRIDESHMUKH|ANTRI\s*DESHMUKH' then return 'Antri Deshmukh'; end if;
  return 'Unassigned';
end;
$$ language plpgsql immutable;

-- Populate / refresh beat labels for all Anjali invoices
update public.tally_invoices
set inferred_beat = _infer_beat_from_party_name(party_name)
where company = 'Anjali Agency';

-- Verify
select
  inferred_beat,
  count(*) as invoices,
  count(*) filter (where delivered_at is not null) as delivered,
  count(*) filter (where dispatched_at is not null and delivered_at is null) as in_transit,
  count(*) filter (where dispatched_at is null) as pending,
  round(sum(total_amount)) as value
from public.tally_invoices
where company = 'Anjali Agency' and voucher_type = 'GST INTERCITY SALES'
group by inferred_beat
order by invoices desc;
