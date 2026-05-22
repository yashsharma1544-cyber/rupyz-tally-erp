-- =============================================================================
-- 58_tally_finyear.sql
--
-- Adds financial-year separation so Anjali's two years aren't merged.
--   - tally_sales.fin_year  ("25-26" / "26-27")
--   - tally_group_shares_compare(company, party_group, basis_year)
--       returns per shop: kg in 25-26, kg in 26-27, and the share% computed
--       from the chosen basis_year. Shops with no sales in the basis year get
--       0% (but still show their other-year kg for context).
--
-- Allocation basis is a YEAR you pass in (we default the UI to 25-26).
-- The old tally_group_shares(company, group) stays for back-compat but the
-- page now uses the compare RPC.
-- =============================================================================

alter table tally_sales add column if not exists fin_year text;
create index if not exists idx_tally_sales_finyear on tally_sales(company, party_group, fin_year);

-- Backfill fin_year from sale_date for any rows already loaded:
--   Indian FY runs Apr 1 -> Mar 31. month >= 4 => "<yy>-<yy+1>", else "<yy-1>-<yy>".
update tally_sales
set fin_year = case
  when extract(month from sale_date) >= 4
    then to_char(sale_date, 'YY') || '-' || to_char(sale_date + interval '1 year', 'YY')
  else to_char(sale_date - interval '1 year', 'YY') || '-' || to_char(sale_date, 'YY')
end
where fin_year is null and sale_date is not null;

-- ---- Year-comparison shares ------------------------------------------------
create or replace function tally_group_shares_compare(
  p_company text,
  p_party_group text,
  p_basis_year text
)
returns table(
  party_name   text,
  kg_2526      numeric,
  kg_2627      numeric,
  basis_kg     numeric,
  share_pct    numeric
)
language sql stable as $$
  with per_shop as (
    select party_name,
      coalesce(sum(qty_kg) filter (where fin_year = '25-26'), 0) as kg_2526,
      coalesce(sum(qty_kg) filter (where fin_year = '26-27'), 0) as kg_2627,
      coalesce(sum(qty_kg) filter (where fin_year = p_basis_year), 0) as basis_kg
    from tally_sales
    where company = p_company and party_group = p_party_group
    group by party_name
  ),
  tot as (select nullif(sum(basis_kg),0) as total from per_shop)
  select
    s.party_name,
    round(s.kg_2526, 2),
    round(s.kg_2627, 2),
    round(s.basis_kg, 2),
    round(case when t.total is null then 0 else 100.0 * s.basis_kg / t.total end, 4)
  from per_shop s cross join tot t
  order by s.basis_kg desc, s.kg_2526 desc, s.party_name;
$$;
grant execute on function tally_group_shares_compare(text, text, text) to authenticated;

-- ---- Which years exist per company (for the UI) ----------------------------
create or replace function tally_company_years(p_company text)
returns table(fin_year text, rows bigint, total_kg numeric)
language sql stable as $$
  select fin_year, count(*), round(coalesce(sum(qty_kg),0),1)
  from tally_sales
  where company = p_company and fin_year is not null
  group by fin_year order by fin_year;
$$;
grant execute on function tally_company_years(text) to authenticated;
