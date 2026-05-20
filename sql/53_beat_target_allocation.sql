-- =============================================================================
-- 53_beat_target_allocation.sql
--
-- Per-journey-cycle beat targets (kg), allocated to customers by their
-- rolling-12-month kg share. Two tables + one RPC.
--
--   beat_targets       one row per (journey_cycle, beat) — the kg target
--   customer_targets   derived rows: each customer's share% + allocated kg
--   beat_customer_shares(beat_id, window_months)  RPC returning each active
--                      customer's historical kg + share% within the beat
--
-- Workflow:
--   1. Admin picks a journey cycle + beat, enters target_kg.
--   2. UI calls beat_customer_shares() to auto-fill each customer's share%.
--   3. Admin can hand-edit any share% (they need not sum to exactly 100;
--      allocated_kg = target_kg * share_pct/100 regardless, and the UI shows
--      the running total so they can balance it).
--   4. Save writes beat_targets + one customer_targets row per customer.
-- =============================================================================

-- ---- Tables ----------------------------------------------------------------

create table if not exists beat_targets (
  id              uuid primary key default gen_random_uuid(),
  journey_cycle_id uuid not null references journey_cycles(id) on delete cascade,
  beat_id         uuid not null references beats(id) on delete cascade,
  target_kg       numeric not null check (target_kg >= 0),
  window_months   int not null default 12,   -- history window used for shares
  created_by      uuid references app_users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (journey_cycle_id, beat_id)
);

create table if not exists customer_targets (
  id              uuid primary key default gen_random_uuid(),
  beat_target_id  uuid not null references beat_targets(id) on delete cascade,
  customer_id     uuid not null references customers(id) on delete cascade,
  share_pct       numeric not null default 0 check (share_pct >= 0),
  target_kg       numeric not null default 0 check (target_kg >= 0),
  hist_kg         numeric not null default 0,  -- historical kg in the window (for reference)
  created_at      timestamptz not null default now(),
  unique (beat_target_id, customer_id)
);

create index if not exists idx_beat_targets_jc on beat_targets(journey_cycle_id);
create index if not exists idx_beat_targets_beat on beat_targets(beat_id);
create index if not exists idx_customer_targets_bt on customer_targets(beat_target_id);
create index if not exists idx_customer_targets_cust on customer_targets(customer_id);

-- ---- Share RPC -------------------------------------------------------------
-- Returns each ACTIVE customer on the beat with their kg volume over the
-- trailing window_months and their share% of the beat's total kg. Customers
-- with zero history are returned with 0 kg / 0% so the admin can still assign
-- them a manual share.

create or replace function beat_customer_shares(
  p_beat_id uuid,
  p_window_months int default 12
)
returns table(
  customer_id   uuid,
  customer_name text,
  city          text,
  hist_kg       numeric,
  share_pct     numeric
)
language sql
stable
as $function$
  with cust as (
    select id, name, city
    from customers
    where beat_id = p_beat_id and active = true
  ),
  kg as (
    select
      o.customer_id,
      coalesce(sum(
        case
          when lower(coalesce(oi.unit,'')) = 'kg' then coalesce(oi.qty,0)
          when lower(coalesce(oi.unit,'')) in ('g','gm') or lower(coalesce(oi.unit,'')) like 'gram%' then coalesce(oi.qty,0)/1000.0
          when lower(coalesce(oi.packaging_unit,'')) = 'kg' then coalesce(oi.qty,0)*coalesce(oi.packaging_size,0)
          when lower(coalesce(oi.packaging_unit,'')) in ('g','gm') or lower(coalesce(oi.packaging_unit,'')) like 'gram%' then (coalesce(oi.qty,0)*coalesce(oi.packaging_size,0))/1000.0
          else 0
        end
      ),0) as hist_kg
    from orders o
    join order_items oi on oi.order_id = o.id
    where o.customer_id in (select id from cust)
      and (o.rupyz_created_at at time zone 'Asia/Kolkata')::date
            >= (current_date - make_interval(months => p_window_months))
    group by o.customer_id
  ),
  joined as (
    select c.id as customer_id, c.name as customer_name, c.city,
           coalesce(k.hist_kg, 0) as hist_kg
    from cust c
    left join kg k on k.customer_id = c.id
  ),
  tot as (select nullif(sum(hist_kg),0) as total_kg from joined)
  select
    j.customer_id,
    j.customer_name,
    j.city,
    round(j.hist_kg, 2) as hist_kg,
    round(case when t.total_kg is null then 0
               else 100.0 * j.hist_kg / t.total_kg end, 4) as share_pct
  from joined j cross join tot t
  order by j.hist_kg desc, j.customer_name;
$function$;

grant execute on function beat_customer_shares(uuid, int) to authenticated;

-- ---- updated_at trigger for beat_targets -----------------------------------
create or replace function touch_beat_targets_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_beat_targets_touch on beat_targets;
create trigger trg_beat_targets_touch
  before update on beat_targets
  for each row execute function touch_beat_targets_updated_at();

-- ---- RLS -------------------------------------------------------------------
-- These tables are written only via server actions using the service-role
-- client, and read via authenticated admin pages. Enable RLS and allow
-- authenticated reads; writes go through service role which bypasses RLS.

alter table beat_targets enable row level security;
alter table customer_targets enable row level security;

drop policy if exists beat_targets_read on beat_targets;
create policy beat_targets_read on beat_targets
  for select using (auth.role() = 'authenticated');

drop policy if exists customer_targets_read on customer_targets;
create policy customer_targets_read on customer_targets
  for select using (auth.role() = 'authenticated');

-- ---- Verify ----------------------------------------------------------------
-- Pick any beat id and check the shares look sane (top customers = biggest %).
-- select * from beat_customer_shares('PUT-A-BEAT-ID-HERE', 12) limit 10;
