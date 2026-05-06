-- ============================================================================
-- 16 — Add 'loading' to order_app_status enum.
--
-- The dispatch flow now has an explicit two-tap stage:
--   approved → loading (dispatch row created, truck not gone) → dispatched (truck left) → delivered
--
-- This adds the new value. The enum is non-removable in Postgres, so we just
-- append it. The default order remains: received < approved < ...
-- ============================================================================

do $$ begin
  alter type order_app_status add value if not exists 'loading' before 'partially_dispatched';
end $$;

-- Quick check:
--   select unnest(enum_range(null::order_app_status)) as s;
