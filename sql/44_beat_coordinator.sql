-- 44_beat_coordinator.sql
-- Marks one (or more) app_users as the daily beat assignment coordinator.
-- The 9:30 AM IST cron sends them a WhatsApp reminder to assign beats
-- before the 9:55 AM morning briefing fires.

alter table app_users
  add column if not exists is_beat_coordinator boolean not null default false;

-- Partial index for fast lookup of coordinators (typically 1-2 rows)
create index if not exists idx_app_users_beat_coordinator
  on app_users (id)
  where is_beat_coordinator = true;

notify pgrst, 'reload schema';
