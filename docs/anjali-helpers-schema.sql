-- =============================================================================
-- tally_dispatches: swap single-driver model for Yash + two optional helpers
--
-- On these trips Yash drives himself; the people on the vehicle are helpers.
-- Adds helper1_* and helper2_* columns (both optional), and migrates any
-- existing driver_* values to helper1_* so earlier dispatches are preserved.
-- The driver_* columns stay in place for a release cycle in case anything
-- still reads them.
--
-- Idempotent: safe to re-run.
-- Run in Supabase SQL editor for project aiekaymlbfypxnczrvgb.
-- =============================================================================

alter table public.tally_dispatches
  add column if not exists helper1_user_id uuid,
  add column if not exists helper1_name text,
  add column if not exists helper2_user_id uuid,
  add column if not exists helper2_name text;

-- Backfill helper1 from legacy driver fields on existing rows
update public.tally_dispatches
set helper1_user_id = driver_user_id,
    helper1_name = driver_name
where driver_user_id is not null
  and helper1_user_id is null;

-- Verify
select
  count(*) as dispatches,
  count(*) filter (where helper1_user_id is not null) as with_helper1,
  count(*) filter (where helper2_user_id is not null) as with_helper2
from public.tally_dispatches;
