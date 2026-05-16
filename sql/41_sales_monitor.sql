-- 41_sales_monitor.sql
-- Continuous & Efficient Sale — Phase 1 foundation tables
--
-- Tables:
--   * salesman_beat_assignments  — which beat each salesman covers on a given day
--   * daily_sales_targets        — admin-set kg targets per salesman per day
--   * daily_sales_checkins       — when a salesman tapped "Checked in" on the morning WhatsApp
--   * daily_sales_reports        — log of every report send (for retry/debug)
--
-- Two salesmen CAN share a beat the same day (joint visit), so the unique
-- constraint is on (salesman_id, assignment_date), not on (beat_id, date).

-- 1. Beat assignment per salesman per day -------------------------------------
create table if not exists salesman_beat_assignments (
  id               uuid        primary key default gen_random_uuid(),
  salesman_id      uuid        not null references salesmen(id) on delete cascade,
  assignment_date  date        not null,
  beat_id          uuid        not null references beats(id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid        references app_users(id),
  unique (salesman_id, assignment_date)
);

create index if not exists idx_sba_date     on salesman_beat_assignments(assignment_date);
create index if not exists idx_sba_salesman on salesman_beat_assignments(salesman_id, assignment_date);
create index if not exists idx_sba_beat     on salesman_beat_assignments(beat_id, assignment_date);

-- 2. Daily kg target per salesman --------------------------------------------
create table if not exists daily_sales_targets (
  id            uuid           primary key default gen_random_uuid(),
  salesman_id   uuid           not null references salesmen(id) on delete cascade,
  target_date   date           not null,
  target_kg     numeric(10,2)  not null check (target_kg > 0),
  created_at    timestamptz    not null default now(),
  updated_at    timestamptz    not null default now(),
  created_by    uuid           references app_users(id),
  unique (salesman_id, target_date)
);

create index if not exists idx_dst_date     on daily_sales_targets(target_date);
create index if not exists idx_dst_salesman on daily_sales_targets(salesman_id, target_date);

-- 3. Check-in event (tap of "Checked in" button on morning WhatsApp) ----------
create table if not exists daily_sales_checkins (
  id              uuid        primary key default gen_random_uuid(),
  salesman_id     uuid        not null references salesmen(id) on delete cascade,
  checkin_date    date        not null,
  checked_in_at   timestamptz not null default now(),
  source          text        not null default 'whatsapp'
                              check (source in ('whatsapp', 'first_order', 'manual')),
  unique (salesman_id, checkin_date)
);

create index if not exists idx_dsc_date on daily_sales_checkins(checkin_date);

-- 4. Report send log ---------------------------------------------------------
create table if not exists daily_sales_reports (
  id                  uuid        primary key default gen_random_uuid(),
  salesman_id         uuid        not null references salesmen(id) on delete cascade,
  report_date         date        not null,
  report_type         text        not null check (report_type in ('morning', 'midday', 'evening')),
  status              text        not null default 'pending'
                                  check (status in ('pending', 'sent', 'failed')),
  sent_at             timestamptz,
  pdf_storage_path    text,
  wati_message_id     text,
  error_message       text,
  attempts            int         not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (salesman_id, report_date, report_type)
);

create index if not exists idx_dsr_date     on daily_sales_reports(report_date, report_type);
create index if not exists idx_dsr_salesman on daily_sales_reports(salesman_id, report_date);
create index if not exists idx_dsr_status   on daily_sales_reports(status) where status != 'sent';

-- 5. RLS — admin only via authenticated requests. Service role bypasses RLS
--    so the cron / WATi webhook routes still work fine.
alter table salesman_beat_assignments enable row level security;
alter table daily_sales_targets       enable row level security;
alter table daily_sales_checkins      enable row level security;
alter table daily_sales_reports       enable row level security;

drop policy if exists "admin all" on salesman_beat_assignments;
drop policy if exists "admin all" on daily_sales_targets;
drop policy if exists "admin all" on daily_sales_checkins;
drop policy if exists "admin all" on daily_sales_reports;

create policy "admin all" on salesman_beat_assignments for all using (
  exists (select 1 from app_users where id = auth.uid() and role = 'admin')
);
create policy "admin all" on daily_sales_targets for all using (
  exists (select 1 from app_users where id = auth.uid() and role = 'admin')
);
create policy "admin all" on daily_sales_checkins for all using (
  exists (select 1 from app_users where id = auth.uid() and role = 'admin')
);
create policy "admin all" on daily_sales_reports for all using (
  exists (select 1 from app_users where id = auth.uid() and role = 'admin')
);

-- 6. updated_at trigger -------------------------------------------------------
-- Reuses the project's update_updated_at_column function if it exists;
-- otherwise creates one.
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sba_updated_at on salesman_beat_assignments;
drop trigger if exists trg_dst_updated_at on daily_sales_targets;
drop trigger if exists trg_dsr_updated_at on daily_sales_reports;

create trigger trg_sba_updated_at before update on salesman_beat_assignments
  for each row execute function update_updated_at_column();
create trigger trg_dst_updated_at before update on daily_sales_targets
  for each row execute function update_updated_at_column();
create trigger trg_dsr_updated_at before update on daily_sales_reports
  for each row execute function update_updated_at_column();
