-- ============================================================================
-- 36 — Rupyz backfill state
--
-- Single-row table holding progress for the one-shot historical backfill.
-- The backfill function reads/writes this row to resume across timeouts.
--
-- Statuses:
--   idle       — never started or last run completed
--   running    — actively being processed (set when function picks up)
--   paused     — function hit its time budget, will resume on next trigger
--   completed  — finished (no more pages or hit cutoff date)
--   failed     — error during run, see error_message
-- ============================================================================

create table if not exists rupyz_backfill_state (
  id                  integer primary key default 1,
  status              text not null default 'idle',
  -- Last page that was FULLY processed. Resume = last_completed_page + 1.
  last_completed_page integer not null default 0,
  -- For safety: hard cap on pagination
  max_pages           integer not null default 1000,
  -- Stop paginating once we've seen orders older than this date
  cutoff_date         timestamptz,
  -- Counters across the entire backfill (accumulated across resumes)
  total_orders_processed   integer not null default 0,
  total_orders_inserted    integer not null default 0,
  total_orders_updated     integer not null default 0,
  total_orders_skipped     integer not null default 0,
  -- Diagnostics
  last_page_orders_count  integer,    -- how many orders the last page returned (helps know if Rupyz is empty)
  last_page_oldest_at     timestamptz, -- oldest order_created_at we saw on the last processed page
  started_at              timestamptz,
  last_run_at             timestamptz,
  finished_at             timestamptz,
  error_message           text,
  -- Safety: enforce singleton
  constraint singleton_backfill check (id = 1)
);

-- Insert the singleton row if it doesn't exist
insert into rupyz_backfill_state (id, status) 
values (1, 'idle')
on conflict (id) do nothing;

-- Helper: reset state to start over (admin can call this if something goes wrong)
create or replace function rupyz_backfill_reset()
returns void
language sql
security definer
set search_path = public
as $$
  update rupyz_backfill_state
  set status = 'idle',
      last_completed_page = 0,
      total_orders_processed = 0,
      total_orders_inserted = 0,
      total_orders_updated = 0,
      total_orders_skipped = 0,
      last_page_orders_count = null,
      last_page_oldest_at = null,
      started_at = null,
      last_run_at = null,
      finished_at = null,
      error_message = null
  where id = 1;
$$;

grant execute on function rupyz_backfill_reset() to authenticated;
