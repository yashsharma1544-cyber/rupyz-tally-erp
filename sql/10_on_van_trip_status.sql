-- ============================================================================
-- 10 — Add 'on_van_trip' to order_app_status enum.
--
-- This is the status an order takes when it has been attached to an active VAN
-- trip but the bill on that trip hasn't been confirmed (delivered) yet.
--
-- ============================================================================
-- IMPORTANT — RUN IN TWO SEPARATE STEPS in Supabase SQL Editor.
-- Postgres requires that a new enum value be committed before any DML can use it,
-- so the ALTER TYPE and the UPDATE cannot share a transaction.
-- ============================================================================


-- =============== STEP 1 — RUN THIS FIRST. WAIT FOR SUCCESS. ================
do $$ begin
  alter type order_app_status add value if not exists 'on_van_trip';
exception when duplicate_object then null; end $$;


-- =============== STEP 2 — RUN THIS NEXT, AS A SEPARATE QUERY. ==============
-- One-off backfill: any order that's currently approved AND has an active
-- (non-cancelled, unconfirmed) trip_bill linked to it should be moved to
-- on_van_trip. Safe to re-run.
update orders o
set app_status = 'on_van_trip'
where o.app_status = 'approved'
  and exists (
    select 1
    from trip_bills tb
    where tb.source_order_id = o.id
      and tb.is_cancelled = false
      and tb.confirmed_at is null
  );
