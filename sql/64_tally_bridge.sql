-- =============================================================================
-- 64_tally_bridge.sql
--
-- STEP 3 of the bridge: turn mapped Tally customer sales into daily_sales_targets
-- for a journey cycle.
--
-- Voucher rules (per company):
--   Anjali Agencies : ALL voucher types,           basis year 25-26
--   Sushil Agencies : GST SALES only,              basis year 26-27
--
-- Logic:
--   1. Per mapped customer (tally_customer_map.status='manual'): sum its Tally
--      kg under the voucher rules, attribute to its REAL beat
--      (coalesce(match_beat_id, beat_id)).
--   2. Per beat: total Tally kg = sum of its customers' kg.
--   3. Per beat: visit_days = # of (salesman,date) assignments in the cycle.
--   4. Daily target for each assignment row = beat_total_kg / visit_days.
--   5. Sum per (salesman, date) across beats -> upsert into daily_sales_targets.
--
-- Safe to re-run: it deletes its own prior rows for the cycle window before
-- writing (so it never double-counts), scoped by the date range you pass.
--
-- USAGE:
--   select * from tally_bridge_apply('2026-05-27','2026-06-23',
--           'db45f333-8885-45e7-b867-f1286a16ee49');   -- admin uuid as created_by
-- Returns one row per (salesman,date) with kg written.
-- =============================================================================

create or replace function tally_bridge_apply(
  p_start date,
  p_end   date,
  p_created_by uuid
)
returns table(salesman_id uuid, target_date date, target_kg numeric)
language plpgsql as $$
begin
  -- ---- per-customer Tally kg under the voucher rules ----------------------
  create temp table _cust_kg on commit drop as
  select cm.customer_id,
         coalesce(cm.match_beat_id, cm.beat_id) as real_beat_id,
         sum(ts.qty_kg) as kg
  from tally_customer_map cm
  join tally_sales ts
    on ts.company = cm.company and ts.party_name = cm.party_name
  where cm.status = 'manual'
    and cm.customer_id is not null
    and (
      (ts.company = 'Anjali Agencies' and ts.fin_year = '25-26')
      or
      (ts.company = 'Sushil Agencies' and ts.fin_year = '26-27' and ts.voucher_type = 'GST SALES')
    )
  group by cm.customer_id, coalesce(cm.match_beat_id, cm.beat_id);

  -- ---- per-beat total target kg -------------------------------------------
  create temp table _beat_kg on commit drop as
  select real_beat_id as beat_id, sum(kg) as beat_kg
  from _cust_kg
  group by real_beat_id;

  -- ---- per-beat visit days in the cycle -----------------------------------
  create temp table _beat_days on commit drop as
  select sba.beat_id, count(*) as visit_days
  from salesman_beat_assignments sba
  where sba.assignment_date between p_start and p_end
  group by sba.beat_id;

  -- ---- per (salesman,date): sum of (beat_kg / visit_days) for their beats --
  create temp table _daily on commit drop as
  select sba.salesman_id, sba.assignment_date as target_date,
         round(sum(bk.beat_kg / bd.visit_days), 2) as target_kg
  from salesman_beat_assignments sba
  join _beat_kg  bk on bk.beat_id = sba.beat_id
  join _beat_days bd on bd.beat_id = sba.beat_id
  where sba.assignment_date between p_start and p_end
  group by sba.salesman_id, sba.assignment_date;

  -- ---- write: clear this window's targets, then insert --------------------
  delete from daily_sales_targets d
  where d.target_date between p_start and p_end
    and d.salesman_id in (select salesman_id from _daily);

  insert into daily_sales_targets (salesman_id, target_date, target_kg, created_by)
  select d.salesman_id, d.target_date, d.target_kg, p_created_by
  from _daily d;

  return query select d.salesman_id, d.target_date, d.target_kg
               from _daily d order by d.target_date, d.salesman_id;
end;
$$;

-- =============================================================================
-- PREVIEW (no writes) — see what a beat would total before applying:
--   select bk.beat_id, b.name, round(bk.beat_kg) kg, bd.visit_days
--   from (select real_beat_id beat_id, sum(kg) beat_kg from (
--           select coalesce(cm.match_beat_id,cm.beat_id) real_beat_id, sum(ts.qty_kg) kg
--           from tally_customer_map cm
--           join tally_sales ts on ts.company=cm.company and ts.party_name=cm.party_name
--           where cm.status='manual' and cm.customer_id is not null
--             and ((ts.company='Anjali Agencies' and ts.fin_year='25-26')
--              or (ts.company='Sushil Agencies' and ts.fin_year='26-27' and ts.voucher_type='GST SALES'))
--           group by 1,cm.customer_id) x group by 1) bk
--   join beats b on b.id=bk.beat_id
--   left join salesman_beat_assignments_count ... ;  -- (use _beat_days logic)
-- =============================================================================
