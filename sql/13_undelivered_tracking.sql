-- ============================================================================
-- 13 — Undelivered tracking
--
-- Adds three states for a pre-order trip bill:
--   1. confirmed_at != null  → bill was delivered (existing)
--   2. is_cancelled = true   → admin cancelled (existing)
--   3. undelivered_at != null → lead couldn't deliver, with reason (NEW)
--
-- These three are mutually exclusive (a CHECK enforces it).
--
-- Also adds orders.needs_reattach: when a pre-order bill is marked undelivered,
-- we set this flag on the source order. The admin's "create trip" UI will
-- surface flagged orders for the corresponding beat as suggestions.
--
-- Safe to re-run.
-- ============================================================================

-- trip_bills new columns
alter table trip_bills
  add column if not exists undelivered_at      timestamptz,
  add column if not exists undelivered_reason  text,
  add column if not exists undelivered_note    text;

create index if not exists trip_bills_undelivered_idx
  on trip_bills(undelivered_at) where undelivered_at is not null;

-- Mutual exclusion: a bill can be EITHER delivered OR undelivered, never both.
-- is_cancelled is allowed alongside either (admin cancellation is meta-state
-- that nullifies the bill for accounting but doesn't erase the lead's record
-- of what happened — historical bills may already have confirmed_at + cancelled).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trip_bills_state_exclusive_chk'
      and conrelid = 'trip_bills'::regclass
  ) then
    alter table trip_bills add constraint trip_bills_state_exclusive_chk
      check (
        -- confirmed_at and undelivered_at are mutually exclusive
        not (confirmed_at is not null and undelivered_at is not null)
      );
  end if;
end $$;

-- If undelivered_at is set, undelivered_reason MUST be set
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trip_bills_undelivered_reason_chk'
      and conrelid = 'trip_bills'::regclass
  ) then
    alter table trip_bills add constraint trip_bills_undelivered_reason_chk
      check (
        undelivered_at is null
        or (undelivered_reason is not null and length(trim(undelivered_reason)) > 0)
      );
  end if;
end $$;

-- ----- orders.needs_reattach --------------------------------------------------
alter table orders
  add column if not exists needs_reattach boolean not null default false;

-- Useful for the "create trip" UI to find candidate orders for a beat
create index if not exists orders_needs_reattach_idx
  on orders(needs_reattach, app_status) where needs_reattach = true;

-- ----- Comments ---------------------------------------------------------------
comment on column trip_bills.undelivered_at      is 'When the lead marked this pre-order undelivered. Mutually exclusive with confirmed_at and is_cancelled.';
comment on column trip_bills.undelivered_reason  is 'Why the bill could not be delivered. Free text; expected values: shop_closed, refused, no_stock, reschedule, wrong_address, other.';
comment on column trip_bills.undelivered_note    is 'Optional free-form note. Required when reason = other.';
comment on column orders.needs_reattach          is 'True when an attached pre-order failed delivery on a previous trip. Surfaced as a re-attach suggestion when admin creates the next trip on this beat.';
