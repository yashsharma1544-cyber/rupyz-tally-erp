-- ============================================================================
-- 38 — Make orders.rupyz_id nullable for CSV-imported historical orders
--
-- The Rupyz CSV exports don't include the numeric rupyz_id (only the string
-- rupyz_order_id like "20251231-38863"). Without dropping the NOT NULL
-- constraint, we can't import historical data from CSV.
--
-- The unique constraint on rupyz_id is preserved — nulls are allowed but
-- duplicates of non-null values are not. So API-synced orders still get
-- their unique rupyz_id, while CSV-imported orders have rupyz_id = null.
-- ============================================================================

alter table orders 
  alter column rupyz_id drop not null;

-- Verify (informational)
do $$
declare
  is_nullable text;
begin
  select c.is_nullable into is_nullable
  from information_schema.columns c
  where c.table_name = 'orders' and c.column_name = 'rupyz_id';
  raise notice 'orders.rupyz_id is_nullable: %', is_nullable;
end $$;
