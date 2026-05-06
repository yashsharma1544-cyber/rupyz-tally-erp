-- ============================================================================
-- 18b — Driver assignment on dispatches + active_drivers view.
--
-- PRECONDITION: 18a must have been run and committed first.
-- ============================================================================

-- Add driver_user_id to dispatches (nullable; existing rows stay null)
alter table dispatches
  add column if not exists driver_user_id uuid references app_users(id) on delete set null;

create index if not exists idx_dispatches_driver_user_id on dispatches(driver_user_id);

-- View of active registered drivers — used by the dispatch wizard dropdown
create or replace view active_drivers as
  select id, full_name, email, phone, active, created_at
  from app_users
  where role = 'driver'
    and active = true
  order by full_name;

grant select on active_drivers to authenticated;

-- Verify:
--   select * from active_drivers;
--   \d dispatches  (should show driver_user_id column)
