-- ============================================================================
-- Rupyz-Tally ERP — Phase 1.5 schema additions
-- Auto-create app_users row on Supabase auth signup, plus full RLS policies.
-- Run this AFTER 01_schema_phase1.sql and 02_import_phase1.sql.
-- Idempotent: drops + recreates triggers and policies.
-- ============================================================================

-- ---- on auth.users insert -> create app_users row -------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role user_role;
begin
  -- role from invite metadata; default to 'salesman' for self-signups
  begin
    v_role := (meta->>'role')::user_role;
  exception when others then
    v_role := 'salesman';
  end;
  if v_role is null then v_role := 'salesman'; end if;

  insert into public.app_users (id, full_name, email, phone, role, salesman_id)
  values (
    new.id,
    coalesce(meta->>'full_name', new.email),
    new.email,
    nullif(meta->>'phone', ''),
    v_role,
    nullif(meta->>'salesman_id', '')::uuid
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- helper: is_admin() returns true if caller is an active admin ---------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from app_users
    where id = auth.uid() and role = 'admin' and active
  );
$$;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- Drop the temporary "authenticated read" policies and add real ones.
-- ============================================================================

-- ---- Drop the temporary policies from 01_schema_phase1.sql ----------------
drop policy if exists "authenticated read salesmen"   on salesmen;
drop policy if exists "authenticated read beats"      on beats;
drop policy if exists "authenticated read categories" on categories;
drop policy if exists "authenticated read brands"     on brands;
drop policy if exists "authenticated read products"   on products;
drop policy if exists "authenticated read customers"  on customers;
drop policy if exists "authenticated read own profile" on app_users;

-- ---- masters: everyone authenticated reads, only admin writes -------------
do $$
declare t text;
begin
  for t in select unnest(array['salesmen','beats','categories','brands','products','customers']) loop
    execute format('drop policy if exists %I on %I', 'read all '   || t, t);
    execute format('drop policy if exists %I on %I', 'write admin '|| t, t);

    execute format($p$
      create policy %I on %I
        for select to authenticated
        using (true)
    $p$, 'read all ' || t, t);

    execute format($p$
      create policy %I on %I
        for all to authenticated
        using (public.is_admin())
        with check (public.is_admin())
    $p$, 'write admin ' || t, t);
  end loop;
end $$;

-- ---- app_users: each user reads own row; admin reads/writes all -----------
drop policy if exists "self read app_users"  on app_users;
drop policy if exists "admin all app_users"  on app_users;

create policy "self read app_users" on app_users
  for select to authenticated using (id = auth.uid());

create policy "admin all app_users" on app_users
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- IMPORTANT — first admin promotion
-- After your first user signs up via the app, run ONE of the snippets below
-- in the SQL editor to promote yourself to admin (replace the email):
--
--   update public.app_users set role = 'admin' where email = 'you@example.com';
--
-- Once you're admin, all further user creation goes through the Users page
-- in the app (which uses the service-role key to send invites).
-- ============================================================================

-- Verify policies exist
select schemaname, tablename, policyname
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;
