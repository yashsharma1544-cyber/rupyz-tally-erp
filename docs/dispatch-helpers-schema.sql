-- =============================================================================
-- dispatch_helpers — lightweight directory of people who ride along on
-- delivery trips (helpers, loaders, driver-for-the-day).
--
-- Separate from app_users so helpers can be added in-app without creating a
-- Supabase auth user — many riders don't need to log in.
--
-- Backfills the existing field team (admin / salesman / collector / helper /
-- driver / van_lead / dispatch roles) from app_users so you don't start empty.
--
-- Idempotent: safe to re-run.
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

-- Backfill from app_users (field roles only). Ignore names that are already
-- present. Use the app_user's id as the helper id so earlier dispatches that
-- stored an app_users.id in helper1_user_id / helper2_user_id still resolve.
insert into public.dispatch_helpers (id, name, role, active)
select u.id, u.full_name, u.role, true
from public.app_users u
where u.active is true
  and u.role in ('admin', 'salesman', 'collector', 'helper', 'driver', 'van_lead', 'dispatch')
  and u.full_name is not null
  and not exists (
    select 1 from public.dispatch_helpers h where lower(h.name) = lower(u.full_name)
  );

-- Verify
select
  count(*) as total_helpers,
  count(*) filter (where active) as active_helpers,
  array_agg(distinct role) filter (where active and role is not null) as roles
from public.dispatch_helpers;
