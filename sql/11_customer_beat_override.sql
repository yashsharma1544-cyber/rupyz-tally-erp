-- ============================================================================
-- 11 — Track local beat overrides on customers.
--
-- When admin edits a customer's beat in our app, we stamp `beat_overridden_at`.
-- The Rupyz sync should respect this stamp and never overwrite the beat for
-- locally-overridden customers (even though current sync code doesn't touch
-- beat_id, this protects against future sync changes).
--
-- Safe to re-run.
-- ============================================================================

alter table customers
  add column if not exists beat_overridden_at timestamptz;

comment on column customers.beat_overridden_at is
  'Non-null = beat_id was set manually by admin in our app. Sync must not overwrite.';
