-- ============================================================================
-- 29 — Fix user_scope_customers
--
-- Previous version (sql/27) joined to beats.salesman_id, which doesn't exist.
-- Real model: customers.salesman_id is the direct FK.
--
-- Today this still returns 0 rows for salesmen (none exist in app_users).
-- That's expected. When salesman accounts are created with matching IDs,
-- this function will work without further changes.
-- ============================================================================

create or replace function user_scope_customers(p_user_id uuid)
returns table (customer_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_active boolean;
begin
  -- Look up the requesting user
  select role, active into v_role, v_active
  from app_users
  where id = p_user_id;

  if not coalesce(v_active, false) then
    -- Inactive or unknown user: empty scope
    return;
  end if;

  if v_role in ('admin', 'approver', 'accounts') then
    -- Privileged roles see all ACTIVE customers
    return query select id::uuid from customers where coalesce(active, true) = true;
    return;
  end if;

  if v_role = 'salesman' then
    -- Salesmen see customers directly assigned to them
    return query
      select id::uuid
      from customers
      where salesman_id = p_user_id
        and coalesce(active, true) = true;
    return;
  end if;

  -- Unknown role: empty scope
  return;
end;
$$;

grant execute on function user_scope_customers(uuid) to authenticated;
grant execute on function user_scope_customers() to authenticated;

-- Verification (run with your admin UUID, not auth.uid() which is null in SQL editor):
--   select count(*) from user_scope_customers('db45f333-8885-45e7-b867-f1286a16ee49'::uuid);
--   Should equal active customers count.
