-- ============================================================================
-- 27 — User scope: which customers can a given user see?
--
-- Admin/approver/accounts: ALL customers
-- Salesman: customers in beats assigned to them
--
-- Returns a set of customer_ids that can be used in CTEs or joins:
--   select * from customers where id in (select customer_id from user_scope_customers(auth.uid()));
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
  -- Look up the requesting user's role
  select role, active into v_role, v_active
  from app_users
  where id = p_user_id;

  if not coalesce(v_active, false) then
    -- Inactive or unknown user: empty scope
    return;
  end if;

  if v_role in ('admin', 'approver', 'accounts') then
    -- Privileged roles see everything
    return query select id::uuid from customers;
    return;
  end if;

  if v_role = 'salesman' then
    -- Salesmen see customers in their assigned beats.
    -- Assumes: beats.salesman_id is the FK to the assigned salesman.
    return query
      select c.id::uuid
      from customers c
      join beats b on b.id = c.beat_id
      where b.salesman_id = p_user_id;
    return;
  end if;

  -- Unknown role: empty scope
  return;
end;
$$;

-- Convenience overload: use the currently-authenticated user
create or replace function user_scope_customers()
returns table (customer_id uuid)
language sql
stable
as $$
  select customer_id from user_scope_customers(auth.uid());
$$;

grant execute on function user_scope_customers(uuid) to authenticated;
grant execute on function user_scope_customers() to authenticated;

-- Verification (run as authenticated user):
--   select count(*) from user_scope_customers();
--   For admin: should equal customers count.
--   For salesman: should equal customers in their beats.
