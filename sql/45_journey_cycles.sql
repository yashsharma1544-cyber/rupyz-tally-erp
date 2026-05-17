-- 45_journey_cycles.sql
-- Journey Cycle planning. A JC is a 28-day period (29-day for JC13) within
-- the Indian financial year during which the supervisor plans a beat for
-- each salesman on each day. Once a JC is planned, the plan is applied to
-- the live salesman_beat_assignments table for the date range.

create table if not exists journey_cycles (
  id          uuid primary key default gen_random_uuid(),
  jc_number   int  not null unique check (jc_number >= 1 and jc_number <= 13),
  start_date  date not null,
  end_date    date not null,
  days_count  int  not null check (days_count > 0 and days_count <= 31),
  fy_label    text not null,
  created_at  timestamptz not null default now()
);

create table if not exists beat_journey_plan (
  id           uuid primary key default gen_random_uuid(),
  jc_id        uuid not null references journey_cycles(id) on delete cascade,
  jc_day       int  not null check (jc_day >= 1 and jc_day <= 29),
  salesman_id  uuid not null references app_users(id)      on delete cascade,
  beat_id      uuid not null references beats(id)          on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (jc_id, jc_day, salesman_id)
);

create index if not exists idx_beat_journey_plan_jc
  on beat_journey_plan(jc_id, jc_day);
create index if not exists idx_beat_journey_plan_salesman
  on beat_journey_plan(salesman_id);

-- RLS: admin only, consistent with other sales-monitor tables
alter table journey_cycles    enable row level security;
alter table beat_journey_plan enable row level security;

drop policy if exists "journey_cycles admin read" on journey_cycles;
create policy "journey_cycles admin read" on journey_cycles
  for select using (
    exists (select 1 from app_users
            where app_users.id = auth.uid()
              and app_users.role = 'admin')
  );

drop policy if exists "beat_journey_plan admin all" on beat_journey_plan;
create policy "beat_journey_plan admin all" on beat_journey_plan
  for all using (
    exists (select 1 from app_users
            where app_users.id = auth.uid()
              and app_users.role = 'admin')
  );

-- Reuse the update_updated_at_column function from migration 41
drop trigger if exists set_updated_at_beat_journey_plan on beat_journey_plan;
create trigger set_updated_at_beat_journey_plan
  before update on beat_journey_plan
  for each row execute function update_updated_at_column();

-- Seed all 13 Journey Cycles for FY 2026-27
insert into journey_cycles (jc_number, start_date, end_date, days_count, fy_label) values
  (1,  '2026-04-01', '2026-04-28', 28, 'FY 2026-27'),
  (2,  '2026-04-29', '2026-05-26', 28, 'FY 2026-27'),
  (3,  '2026-05-27', '2026-06-23', 28, 'FY 2026-27'),
  (4,  '2026-06-24', '2026-07-21', 28, 'FY 2026-27'),
  (5,  '2026-07-22', '2026-08-18', 28, 'FY 2026-27'),
  (6,  '2026-08-19', '2026-09-15', 28, 'FY 2026-27'),
  (7,  '2026-09-16', '2026-10-13', 28, 'FY 2026-27'),
  (8,  '2026-10-14', '2026-11-10', 28, 'FY 2026-27'),
  (9,  '2026-11-11', '2026-12-08', 28, 'FY 2026-27'),
  (10, '2026-12-09', '2027-01-05', 28, 'FY 2026-27'),
  (11, '2027-01-06', '2027-02-02', 28, 'FY 2026-27'),
  (12, '2027-02-03', '2027-03-02', 28, 'FY 2026-27'),
  (13, '2027-03-03', '2027-03-31', 29, 'FY 2026-27')
on conflict (jc_number) do nothing;

notify pgrst, 'reload schema';
