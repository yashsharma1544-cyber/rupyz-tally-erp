-- ============================================================================
-- 26 — Customer visit log
--
-- One row per "Mark visited" tap. Lets us track sales coverage:
--   - "When did anyone last visit this customer?"
--   - "Which customers haven't been visited in 30 days?"
--   - "How many visits did salesman X make this week?"
--
-- Schema is intentionally minimal. The visit doesn't try to capture WHAT
-- was discussed — that's a CRM-grade feature. This is just a tap-and-go
-- log of "I was here."
-- ============================================================================

create table if not exists customer_visits (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete cascade,
  user_id       uuid not null references app_users(id) on delete set null,
  visited_at    timestamptz not null default now(),
  note          text,            -- optional, for future use; ignored in v1 UI
  created_at    timestamptz not null default now()
);

create index if not exists idx_customer_visits_customer on customer_visits(customer_id, visited_at desc);
create index if not exists idx_customer_visits_user on customer_visits(user_id, visited_at desc);
create index if not exists idx_customer_visits_date on customer_visits(visited_at desc);

alter table customer_visits enable row level security;

-- Everyone can read visits (they're operationally useful for anyone)
drop policy if exists "read visits" on customer_visits;
create policy "read visits" on customer_visits
  for select to authenticated using (true);

-- Only the visiting user can insert their own visit
drop policy if exists "insert own visit" on customer_visits;
create policy "insert own visit" on customer_visits
  for insert to authenticated
  with check (user_id = auth.uid());

-- Verification:
--   select count(*) from customer_visits;
