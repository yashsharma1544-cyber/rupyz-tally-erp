-- 46_areas_table.sql
-- Promote `area` from a text column on beats to a proper first-class table
-- with id + name. Beats reference it via area_id (FK). Lets admins create,
-- rename, and delete areas, and lets the JC target-distribution tool store
-- targets per area.id.

-- 1. Create the areas table
create table if not exists areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: admin only
alter table areas enable row level security;
drop policy if exists "areas admin all" on areas;
create policy "areas admin all" on areas
  for all using (
    exists (select 1 from app_users
            where app_users.id = auth.uid()
              and app_users.role = 'admin')
  );

-- Read access for other roles (so analytics queries can join in)
drop policy if exists "areas read all auth" on areas;
create policy "areas read all auth" on areas
  for select using (auth.uid() is not null);

-- Updated_at trigger
drop trigger if exists set_updated_at_areas on areas;
create trigger set_updated_at_areas
  before update on areas
  for each row execute function update_updated_at_column();

-- 2. Add area_id FK to beats
alter table beats
  add column if not exists area_id uuid references areas(id) on delete set null;

create index if not exists idx_beats_area_id
  on beats(area_id) where area_id is not null;

-- 3. Migrate any existing text values from beats.area (if that column exists)
--    into the areas table and link via area_id.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'beats' and column_name = 'area'
  ) then
    -- Insert distinct non-empty area names
    insert into areas (name)
    select distinct trim(area)
    from beats
    where area is not null
      and trim(area) <> ''
    on conflict (name) do nothing;

    -- Link beats.area_id by name match
    update beats b
       set area_id = a.id
      from areas a
     where b.area is not null
       and trim(b.area) = a.name
       and b.area_id is null;

    -- Drop the old text column now that data is migrated
    alter table beats drop column area;
  end if;
end $$;

notify pgrst, 'reload schema';
