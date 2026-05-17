-- 47_jc_targets.sql
-- Tables and RPC for Phase 8: target distribution across area → beats → customers.
--
-- Workflow:
--   1. Admin sets area_jc_targets.target_kg for a JC + area.
--   2. Beat shares default to historical kg share (last 84 days) + equal-share
--      fallback for zero-history beats. Admin can manually override any
--      beat's share_pct; is_manual flags those overrides.
--   3. Customer shares within each beat follow the same pattern.
--   4. target_kg at each level is computed and stored: beat_target = area_target
--      * beat.share_pct; customer_target = beat_target * customer.share_pct.

create table if not exists area_jc_targets (
  id          uuid primary key default gen_random_uuid(),
  jc_id       uuid not null references journey_cycles(id) on delete cascade,
  area_id     uuid not null references areas(id)          on delete cascade,
  target_kg   numeric(12,3) not null check (target_kg >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (jc_id, area_id)
);

create table if not exists beat_jc_targets (
  id          uuid primary key default gen_random_uuid(),
  jc_id       uuid not null references journey_cycles(id) on delete cascade,
  beat_id     uuid not null references beats(id)          on delete cascade,
  share_pct   numeric(7,4)   not null check (share_pct >= 0 and share_pct <= 100),
  target_kg   numeric(12,3)  not null check (target_kg >= 0),
  is_manual   boolean        not null default false,
  created_at  timestamptz    not null default now(),
  updated_at  timestamptz    not null default now(),
  unique (jc_id, beat_id)
);

create table if not exists customer_jc_targets (
  id          uuid primary key default gen_random_uuid(),
  jc_id       uuid not null references journey_cycles(id) on delete cascade,
  customer_id uuid not null references customers(id)      on delete cascade,
  share_pct   numeric(7,4)   not null check (share_pct >= 0 and share_pct <= 100),
  target_kg   numeric(12,3)  not null check (target_kg >= 0),
  is_manual   boolean        not null default false,
  created_at  timestamptz    not null default now(),
  updated_at  timestamptz    not null default now(),
  unique (jc_id, customer_id)
);

create index if not exists idx_beat_jc_targets_jc on beat_jc_targets(jc_id);
create index if not exists idx_customer_jc_targets_jc on customer_jc_targets(jc_id);

-- RLS
alter table area_jc_targets     enable row level security;
alter table beat_jc_targets     enable row level security;
alter table customer_jc_targets enable row level security;

drop policy if exists "area_jc_targets admin"     on area_jc_targets;
drop policy if exists "beat_jc_targets admin"     on beat_jc_targets;
drop policy if exists "customer_jc_targets admin" on customer_jc_targets;

create policy "area_jc_targets admin" on area_jc_targets
  for all using (
    exists (select 1 from app_users
            where app_users.id = auth.uid()
              and app_users.role = 'admin')
  );

create policy "beat_jc_targets admin" on beat_jc_targets
  for all using (
    exists (select 1 from app_users
            where app_users.id = auth.uid()
              and app_users.role = 'admin')
  );

create policy "customer_jc_targets admin" on customer_jc_targets
  for all using (
    exists (select 1 from app_users
            where app_users.id = auth.uid()
              and app_users.role = 'admin')
  );

drop trigger if exists set_updated_at_area_jc_targets     on area_jc_targets;
drop trigger if exists set_updated_at_beat_jc_targets     on beat_jc_targets;
drop trigger if exists set_updated_at_customer_jc_targets on customer_jc_targets;

create trigger set_updated_at_area_jc_targets
  before update on area_jc_targets
  for each row execute function update_updated_at_column();

create trigger set_updated_at_beat_jc_targets
  before update on beat_jc_targets
  for each row execute function update_updated_at_column();

create trigger set_updated_at_customer_jc_targets
  before update on customer_jc_targets
  for each row execute function update_updated_at_column();

-- ------------------------------------------------------------------
-- RPC: returns one row per (beat, customer) in an area with their
-- last-84-day kg totals. Used to seed default shares.
-- ------------------------------------------------------------------
create or replace function area_distribution_84d(p_area_id uuid)
returns table(
  beat_id          uuid,
  beat_name        text,
  beat_kg_84d      numeric,
  customer_id      uuid,
  customer_name    text,
  customer_kg_84d  numeric
)
language sql
stable
as $$
  with beat_kg as (
    select c.beat_id, sum(oi.qty * coalesce(oi.packaging_size, 1)) as kg
    from customers c
    join orders      o  on o.customer_id = c.id
    join order_items oi on oi.order_id   = o.id
    where o.rupyz_created_at >= now() - interval '84 days'
      and oi.packaging_unit ilike 'kg'
    group by c.beat_id
  ),
  cust_kg as (
    select o.customer_id, sum(oi.qty * coalesce(oi.packaging_size, 1)) as kg
    from orders      o
    join order_items oi on oi.order_id = o.id
    where o.rupyz_created_at >= now() - interval '84 days'
      and oi.packaging_unit ilike 'kg'
    group by o.customer_id
  )
  select
    b.id   as beat_id,
    b.name as beat_name,
    coalesce(bk.kg, 0)::numeric as beat_kg_84d,
    c.id   as customer_id,
    c.name as customer_name,
    coalesce(ck.kg, 0)::numeric as customer_kg_84d
  from beats b
  left join customers c  on c.beat_id      = b.id
  left join beat_kg   bk on bk.beat_id     = b.id
  left join cust_kg   ck on ck.customer_id = c.id
  where b.area_id = p_area_id
  order by b.name, c.name;
$$;

notify pgrst, 'reload schema';
