-- ============================================================================
-- Rupyz-Tally ERP — Phase 3 schema
-- Adds: order_audit_events, order_revisions, dispatches, dispatch_items, pods
-- Alters: orders (is_edited tracking), order_items (no changes)
-- Idempotent. Run AFTER 04_phase2_orders.sql.
-- ============================================================================

-- ---- existing orders table additions --------------------------------------
alter table orders
  add column if not exists is_edited boolean not null default false,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references app_users(id) on delete set null;

-- ============================================================================
-- order_audit_events — every state-changing action on an order
-- ============================================================================
create table if not exists order_audit_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  event_type  text not null,
    -- 'approved' | 'rejected' | 'edited' | 'dispatch_created' |
    -- 'dispatch_shipped' | 'dispatch_delivered' | 'dispatch_cancelled' |
    -- 'order_cancelled' | 'order_closed'
  actor_id    uuid references app_users(id) on delete set null,
  actor_name  text,
  comment     text,
  details     jsonb,         -- e.g. for 'edited': list of changes
  created_at  timestamptz default now()
);

create index if not exists order_audit_events_order_idx on order_audit_events(order_id, created_at desc);

-- ============================================================================
-- order_revisions — full snapshot of order state at each edit
-- (immutable history; the "Rupyz Original" = revision_number 0 view)
-- ============================================================================
create table if not exists order_revisions (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  revision_number int  not null,
  snapshot        jsonb not null,
  edited_by       uuid references app_users(id) on delete set null,
  edited_by_name  text,
  edited_at       timestamptz default now(),
  change_summary  text,
  unique (order_id, revision_number)
);

create index if not exists order_revisions_order_idx on order_revisions(order_id, revision_number);

-- ============================================================================
-- dispatches — one row per shipment from a single order
-- ============================================================================
create table if not exists dispatches (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete restrict,
  dispatch_number   text unique not null,
  status            text not null default 'pending',
    -- 'pending' (created, not yet shipped)
    -- 'shipped' (truck has left warehouse)
    -- 'delivered' (POD captured)
    -- 'cancelled' (warehouse error etc)
  vehicle_number    text,
  driver_name       text,
  driver_phone      text,
  notes             text,
  total_qty         numeric(14,4),
  total_amount      numeric(14,2),
  created_by        uuid references app_users(id) on delete set null,
  created_at        timestamptz default now(),
  shipped_at        timestamptz,
  shipped_by        uuid references app_users(id) on delete set null,
  delivered_at      timestamptz,
  delivered_by      uuid references app_users(id) on delete set null,
  cancelled_at      timestamptz,
  cancelled_by      uuid references app_users(id) on delete set null,
  cancel_reason     text,
  updated_at        timestamptz default now()
);

create index if not exists dispatches_order_idx  on dispatches(order_id);
create index if not exists dispatches_status_idx on dispatches(status);

create or replace trigger trg_dispatches_updated
  before update on dispatches
  for each row execute function set_updated_at();

-- ============================================================================
-- dispatch_items — qty per line item shipped in this dispatch
-- ============================================================================
create table if not exists dispatch_items (
  id              uuid primary key default gen_random_uuid(),
  dispatch_id     uuid not null references dispatches(id) on delete cascade,
  order_item_id   uuid not null references order_items(id) on delete restrict,
  qty             numeric(14,4) not null check (qty > 0),
  price           numeric(14,4) not null,         -- snapshot at dispatch time
  total_amount    numeric(14,2) not null,         -- snapshot
  created_at      timestamptz default now()
);

create index if not exists dispatch_items_dispatch_idx on dispatch_items(dispatch_id);
create index if not exists dispatch_items_order_item_idx on dispatch_items(order_item_id);

-- ============================================================================
-- pods — proof of delivery (one per dispatch)
-- ============================================================================
create table if not exists pods (
  id            uuid primary key default gen_random_uuid(),
  dispatch_id   uuid unique not null references dispatches(id) on delete cascade,
  photo_url     text,
  latitude      numeric(10,7),
  longitude     numeric(10,7),
  accuracy_m    numeric(8,2),
  receiver_name text,
  notes         text,
  captured_at   timestamptz default now(),
  captured_by   uuid references app_users(id) on delete set null
);

-- ============================================================================
-- helpers
-- ============================================================================

-- Generate next dispatch number for today: D-YYYYMMDD-NNNN
create or replace function next_dispatch_number()
returns text language plpgsql as $$
declare
  prefix text;
  next_n int;
begin
  prefix := 'D-' || to_char(now(), 'YYYYMMDD');
  select coalesce(max(substring(dispatch_number from '\d+$')::int), 0) + 1
    into next_n
    from dispatches
    where dispatch_number like prefix || '-%';
  return prefix || '-' || lpad(next_n::text, 4, '0');
end;
$$;

-- Auth helpers for RLS
create or replace function user_has_role(roles text[])
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from app_users
    where id = auth.uid() and active and role::text = any(roles)
  );
$$;

-- ============================================================================
-- RLS for new tables
-- ============================================================================
alter table order_audit_events enable row level security;
alter table order_revisions    enable row level security;
alter table dispatches         enable row level security;
alter table dispatch_items     enable row level security;
alter table pods               enable row level security;

-- read: all authenticated; write: server actions use service role so we keep
-- this simple — UI will go through server actions, not direct client mutations
drop policy if exists "read all order_audit_events" on order_audit_events;
create policy "read all order_audit_events" on order_audit_events
  for select to authenticated using (true);

drop policy if exists "read all order_revisions" on order_revisions;
create policy "read all order_revisions" on order_revisions
  for select to authenticated using (true);

drop policy if exists "read all dispatches" on dispatches;
create policy "read all dispatches" on dispatches
  for select to authenticated using (true);

drop policy if exists "read all dispatch_items" on dispatch_items;
create policy "read all dispatch_items" on dispatch_items
  for select to authenticated using (true);

drop policy if exists "read all pods" on pods;
create policy "read all pods" on pods
  for select to authenticated using (true);

-- ============================================================================
-- Storage bucket for POD photos (run once)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pod-photos', 'pod-photos', true,
  10485760,                                                       -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Anyone authenticated can upload to pod-photos
drop policy if exists "auth upload pod-photos" on storage.objects;
create policy "auth upload pod-photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pod-photos');

drop policy if exists "auth read pod-photos" on storage.objects;
create policy "auth read pod-photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'pod-photos');

-- ============================================================================
-- DONE
-- Verify with:
--   select count(*) from dispatches;
--   select count(*) from order_audit_events;
--   select * from storage.buckets where id = 'pod-photos';
-- ============================================================================
