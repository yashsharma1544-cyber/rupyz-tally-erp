-- =============================================================================
-- Party → Beat manual overrides for Anjali Agency
--
-- The regex in _infer_beat_from_party_name() catches ~40% of parties where
-- the beat appears in the name ("Govind Kirana ( S Pur)", "Durga Kirana S Pur").
-- The remaining ~60% have no location in the name (e.g. "Shri Mahaveer Kirana"
-- is a Mehkar customer — only Yash knows that).
--
-- This table stores manual party→beat decisions made via the Parties & Beats
-- admin page (/out-for-delivery/parties). When a mapping is saved, the server
-- action also stamps tally_invoices.inferred_beat for every invoice from that
-- party so the UI stays consistent without re-reading the override on each query.
--
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.tally_party_beat_overrides (
  party_name text primary key,
  beat text not null,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz default now()
);

create index if not exists tally_party_beat_overrides_beat_idx
  on public.tally_party_beat_overrides (beat);

-- When an override exists, apply it to all invoices (one-shot catch-up).
-- Normally the admin server action keeps these in sync; this is for drift repair.
update public.tally_invoices ti
set inferred_beat = o.beat
from public.tally_party_beat_overrides o
where ti.party_name = o.party_name
  and ti.company = 'Anjali Agency'
  and (ti.inferred_beat is distinct from o.beat);

-- Verify
select
  (select count(*) from public.tally_party_beat_overrides) as overrides_set,
  (select count(distinct party_name) from public.tally_invoices
     where company='Anjali Agency' and voucher_type='GST INTERCITY SALES'
       and inferred_beat = 'Unassigned') as still_unassigned_parties;
