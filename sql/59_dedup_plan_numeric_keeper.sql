-- =============================================================================
-- 59_dedup_plan_numeric_keeper.sql
--
-- Redefines dedup_plan() so the KEEPER is the record whose rupyz_code is the
-- live NUMERIC code (the format the Rupyz sync writes to going forward), rather
-- than whichever record happened to have the most orders.
--
-- New keeper ranking within each mobile group:
--   1. numeric rupyz_code  (^[0-9]+$)   <- strongly preferred
--   2. most orders
--   3. oldest created_at
--
-- Everything else (mobile-keyed grouping, dummy-mobile skip) is unchanged.
-- dedup_customers_apply() does NOT change — it consumes dedup_plan() and still
-- re-points orders/targets/outstanding, stashes the loser code in
-- rupyz_code_alt, backfills, and deactivates the loser. Because the keeper is
-- now the numeric record, the loser's CU/CW code lands in rupyz_code_alt — so
-- the patched edge function can still match it, AND the live numeric sync hits
-- the keeper directly.
-- =============================================================================

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
      and norm_mobile(c.mobile) is not null
  ),
  groups as (
    select nm from active_cust group by nm having count(*) > 1
  ),
  ranked as (
    select ac.*,
      row_number() over (
        partition by ac.nm
        order by
          (case when ac.rupyz_code ~ '^[0-9]+$' then 0 else 1 end),  -- numeric code FIRST
          ac.orders desc,                                            -- then most orders
          ac.created_at asc                                          -- then oldest
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

-- ---- Re-check the keeper split after this change ---------------------------
-- select
--   case when keeper_code ~ '^[0-9]+$' then 'numeric (good)' else 'CU/CW' end ktype,
--   count(*) from dedup_plan() group by 1;
-- Expect: nearly all 'numeric (good)' now. The only CU/CW keepers left are
-- groups where NEITHER record has a numeric code (both are CU/CW) — those are
-- fine, since neither is the live-sync format and rupyz_code_alt covers it.
