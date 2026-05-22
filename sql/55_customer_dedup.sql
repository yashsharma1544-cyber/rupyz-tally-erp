-- =============================================================================
-- 55_customer_dedup.sql
--
-- Merges duplicate customers created by the rupyz-sync edge function failing to
-- match legacy CU/CW records (it only matched on rupyz_id / numeric rupyz_code).
--
-- STRATEGY: group active customers by normalized mobile (last 10 digits).
-- Within each group with >1 record, pick a KEEPER and fold the others into it:
--   - re-point orders, customer_jc_targets, customer_targets (if exists),
--     salesman_beat_assignments? (no — those are by beat), tally_outstanding
--   - copy the loser's rupyz_code into keeper.rupyz_code_alt (so future syncs
--     matching either code find the keeper)
--   - back-fill keeper.rupyz_id from whichever record has it
--   - deactivate the loser (is_stub stays; active=false) — reversible, not deleted
--
-- KEEPER PICK (within a mobile group):
--   1. most orders
--   2. tie -> numeric rupyz_code (preferred, it's what live sync uses)
--   3. tie -> oldest created_at
--
-- DUMMY MOBILES: numbers like 9999999999, 8888888xxx, 7777777xxx, 7777700xxx are
-- Rupyz placeholders, NOT real. Records whose ONLY identifier is a dummy mobile
-- are NOT grouped by mobile (we don't want to merge two unrelated shops that both
-- got 7777777xxx). They're left alone for manual review.
--
-- Run order:
--   1. select * from dedup_customers_dryrun();   -- review, no changes
--   2. select * from dedup_customers_apply();     -- performs the merge
-- =============================================================================

-- ---- Add the alt-code column the edge function will use --------------------
alter table customers add column if not exists rupyz_code_alt text;
create index if not exists idx_customers_rupyz_code_alt on customers(rupyz_code_alt);

-- ---- Helper: is this mobile a dummy/placeholder? ---------------------------
create or replace function is_dummy_mobile(m text)
returns boolean language sql immutable as $$
  select case
    when m is null then true
    when length(regexp_replace(m,'\D','','g')) < 10 then true
    else regexp_replace(m,'\D','','g') ~ '(9999999999|8888888|7777777|7777700|7777770)'
  end;
$$;

-- ---- Normalized mobile (last 10 digits, null if dummy) ---------------------
create or replace function norm_mobile(m text)
returns text language sql immutable as $$
  select case
    when is_dummy_mobile(m) then null
    else right(regexp_replace(m,'\D','','g'), 10)
  end;
$$;

-- ---- Core: compute merge plan ----------------------------------------------
-- Returns one row per (loser -> keeper) pair that WOULD be merged.
create or replace function dedup_plan()
returns table(
  keeper_id    uuid,
  keeper_name  text,
  keeper_code  text,
  keeper_orders bigint,
  loser_id     uuid,
  loser_name   text,
  loser_code   text,
  loser_orders bigint,
  mobile       text
)
language sql stable as $$
  with active_cust as (
    select c.id, c.name, c.rupyz_code, c.rupyz_id, c.created_at,
           norm_mobile(c.mobile) as nm,
           (select count(*) from orders o where o.customer_id = c.id) as orders
    from customers c
    where c.active = true
      and norm_mobile(c.mobile) is not null   -- skip dummy/placeholder-only rows
  ),
  groups as (
    select nm
    from active_cust
    group by nm
    having count(*) > 1
  ),
  ranked as (
    select ac.*,
      row_number() over (
        partition by ac.nm
        order by ac.orders desc,
                 (case when ac.rupyz_code ~ '^[0-9]+$' then 0 else 1 end),  -- numeric first
                 ac.created_at asc
      ) as rn
    from active_cust ac
    join groups g on g.nm = ac.nm
  ),
  keepers as (select * from ranked where rn = 1),
  losers  as (select * from ranked where rn > 1)
  select
    k.id, k.name, k.rupyz_code, k.orders,
    l.id, l.name, l.rupyz_code, l.orders,
    l.nm
  from losers l
  join keepers k on k.nm = l.nm
  order by k.name, l.rupyz_code;
$$;

-- ---- Dry run: summary the admin reviews ------------------------------------
create or replace function dedup_customers_dryrun()
returns table(
  total_groups        bigint,
  total_losers        bigint,
  loser_orders_to_move bigint,
  sample_keeper       text,
  sample_loser        text
)
language sql stable as $$
  select
    (select count(distinct keeper_id) from dedup_plan()),
    (select count(*) from dedup_plan()),
    (select coalesce(sum(loser_orders),0) from dedup_plan()),
    (select keeper_name || ' [' || coalesce(keeper_code,'?') || ']' from dedup_plan() order by loser_orders desc limit 1),
    (select loser_name  || ' [' || coalesce(loser_code,'?')  || ']' from dedup_plan() order by loser_orders desc limit 1);
$$;

-- ---- Apply: perform the merges ---------------------------------------------
create or replace function dedup_customers_apply()
returns table(
  merged_losers   int,
  orders_moved    int,
  jc_targets_moved int,
  cust_targets_moved int,
  outstanding_moved int
)
language plpgsql as $$
declare
  r record;
  v_merged int := 0;
  v_orders int := 0;
  v_jc int := 0;
  v_ct int := 0;
  v_out int := 0;
  v_has_customer_targets boolean;
  v_tmp int;
begin
  -- does the (legacy) customer_targets table still exist?
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='customer_targets'
  ) into v_has_customer_targets;

  for r in select * from dedup_plan() loop
    -- 1. move orders
    update orders set customer_id = r.keeper_id where customer_id = r.loser_id;
    get diagnostics v_tmp = row_count; v_orders := v_orders + v_tmp;

    -- 2. move customer_jc_targets (avoid unique clash: delete loser rows that
    --    would collide with an existing keeper row for same jc)
    delete from customer_jc_targets cl
    where cl.customer_id = r.loser_id
      and exists (select 1 from customer_jc_targets ck
                  where ck.customer_id = r.keeper_id and ck.jc_id = cl.jc_id);
    update customer_jc_targets set customer_id = r.keeper_id where customer_id = r.loser_id;
    get diagnostics v_tmp = row_count; v_jc := v_jc + v_tmp;

    -- 3. legacy customer_targets (if table still present)
    if v_has_customer_targets then
      execute 'delete from customer_targets cl where cl.customer_id = $1
               and exists (select 1 from customer_targets ck
                           where ck.customer_id = $2 and ck.beat_target_id = cl.beat_target_id)'
        using r.loser_id, r.keeper_id;
      execute 'update customer_targets set customer_id = $1 where customer_id = $2'
        using r.keeper_id, r.loser_id;
      get diagnostics v_tmp = row_count; v_ct := v_ct + v_tmp;
    end if;

    -- 4. tally_outstanding (re-point match)
    update tally_outstanding set customer_id = r.keeper_id where customer_id = r.loser_id;
    get diagnostics v_tmp = row_count; v_out := v_out + v_tmp;

    -- 5. stash loser's code in keeper.rupyz_code_alt (first one wins), and
    --    backfill keeper.rupyz_id from loser if keeper lacks it
    update customers k
    set rupyz_code_alt = coalesce(k.rupyz_code_alt, l.rupyz_code),
        rupyz_id       = coalesce(k.rupyz_id, l.rupyz_id),
        mobile         = coalesce(k.mobile, l.mobile),
        gstin          = coalesce(k.gstin, l.gstin)
    from customers l
    where k.id = r.keeper_id and l.id = r.loser_id;

    -- 6. deactivate the loser (reversible)
    update customers set active = false,
      name = name || ' [merged→keeper]'
    where id = r.loser_id;

    v_merged := v_merged + 1;
  end loop;

  return query select v_merged, v_orders, v_jc, v_ct, v_out;
end;
$$;

-- =============================================================================
-- USAGE
--   select * from dedup_customers_dryrun();   -- review first
--   select * from dedup_customers_apply();    -- then apply
--
-- After apply, re-check duplicates:
--   select count(*) from (
--     select norm_mobile(mobile) nm from customers
--     where active=true and norm_mobile(mobile) is not null
--     group by 1 having count(*)>1
--   ) x;
-- =============================================================================
