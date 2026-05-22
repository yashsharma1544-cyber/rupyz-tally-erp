-- =============================================================================
-- 57_tally_multicompany.sql
--
-- Extends the Tally Targets system to TWO companies with voucher-type filtering.
--   - adds tally_sales.company       ("Sushil Agencies" / "Anjali Agencies")
--   - adds tally_sales.voucher_type  ("GST SALES" / "GST INTERCITY SALES" / "NEW MONDHA")
--   - tally_beat_targets gets a company column too (targets are per company+beat+period)
--   - RPCs become company-aware
--
-- Source scope (enforced at import time by the refresh endpoint):
--   Sushil Agencies : 26-27 only — GST SALES + NEW MONDHA
--   Anjali Agencies : 25-26 and 26-27 — GST SALES + GST INTERCITY SALES + NEW MONDHA
--                     (PRIYA SALES excluded)
-- =============================================================================

alter table tally_sales add column if not exists company text;
alter table tally_sales add column if not exists voucher_type text;
create index if not exists idx_tally_sales_company on tally_sales(company);
create index if not exists idx_tally_sales_company_group on tally_sales(company, party_group);

alter table tally_beat_targets add column if not exists company text;
-- widen the uniqueness to include company so each company has its own targets
alter table tally_beat_targets drop constraint if exists tally_beat_targets_party_group_period_label_key;
drop index if exists tally_beat_targets_company_pg_period_uniq;
create unique index if not exists tally_beat_targets_company_pg_period_uniq
  on tally_beat_targets(company, party_group, period_label);

-- ---- Company-aware party-groups list ---------------------------------------
create or replace function tally_party_groups(p_company text default null)
returns table(company text, party_group text, root_group text, parties bigint, total_kg numeric)
language sql stable as $$
  select company, party_group,
         max(root_group) as root_group,
         count(distinct party_name) as parties,
         round(coalesce(sum(qty_kg),0),1) as total_kg
  from tally_sales
  where party_group is not null
    and (p_company is null or company = p_company)
  group by company, party_group
  order by company, total_kg desc;
$$;
grant execute on function tally_party_groups(text) to authenticated;

-- ---- Company-aware shares --------------------------------------------------
create or replace function tally_group_shares(
  p_company text,
  p_party_group text,
  p_from date default null,
  p_to   date default null
)
returns table(party_name text, hist_kg numeric, share_pct numeric)
language sql stable as $$
  with rows as (
    select party_name, coalesce(sum(qty_kg),0) as kg
    from tally_sales
    where company = p_company
      and party_group = p_party_group
      and (p_from is null or sale_date >= p_from)
      and (p_to   is null or sale_date <= p_to)
    group by party_name
  ),
  tot as (select nullif(sum(kg),0) as total from rows)
  select r.party_name, round(r.kg,2),
         round(case when t.total is null then 0 else 100.0*r.kg/t.total end, 4)
  from rows r cross join tot t
  order by r.kg desc, r.party_name;
$$;
grant execute on function tally_group_shares(text, text, date, date) to authenticated;

-- list of companies present
create or replace function tally_companies()
returns table(company text, rows bigint, total_kg numeric)
language sql stable as $$
  select company, count(*), round(coalesce(sum(qty_kg),0),1)
  from tally_sales where company is not null
  group by company order by company;
$$;
grant execute on function tally_companies() to authenticated;
