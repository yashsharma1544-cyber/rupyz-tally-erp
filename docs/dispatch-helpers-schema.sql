-- =============================================================================
-- dispatch_helpers — lightweight directory of people who ride along on
-- delivery trips (helpers, loaders, driver-for-the-day).
--
-- Separate from app_users so helpers can be added in-app without creating a
-- Supabase auth user — many riders don't need to log in. Yash explicitly
-- wanted this directory to start empty and be built up by hand from the
-- Create Dispatch modal's "+ New" button rather than auto-populated from
-- the existing field team.
--
-- Idempotent: safe to re-run (table + indexes only; no data seeded).
-- Run in Supabase SQL editor for project aiekaymlbfypxnczrvgb.
-- =============================================================================

create table if not exists public.dispatch_helpers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  active boolean default true,
  created_at timestamptz default now(),
  created_by uuid,
  created_by_name text
);

-- One row per name (case-insensitive). A nullable unique index would allow
-- NULL names, but we require name not null anyway.
create unique index if not exists dispatch_helpers_name_lower_uniq
  on public.dispatch_helpers (lower(name));

create index if not exists dispatch_helpers_active_idx
  on public.dispatch_helpers (active) where active;

-- Verify
select
  count(*) as total_helpers,
  count(*) filter (where active) as active_helpers
from public.dispatch_helpers;
