-- ============================================================================
-- 21 — Per-product weight (kg per single sellable pack/piece)
--
-- Foundation for kg-based sales analytics. Each product row gets a nullable
-- weight_kg representing how many kg ONE unit of this product weighs.
--
-- Examples:
--   "Red Label 250g pack"        → weight_kg = 0.250
--   "Atta 5 kg bag"              → weight_kg = 5.000
--   "Soap bar 100g"              → weight_kg = 0.100
--   "Dettol bottle (not weighed)" → weight_kg = NULL  (excluded from kg metrics)
--
-- Admin UI on /products lets the team fill these in. Until weight_kg is set,
-- that product simply doesn't contribute to kg-based dashboards.
-- ============================================================================

alter table products
  add column if not exists weight_kg numeric(10, 4);

comment on column products.weight_kg is
  'Weight in kg of one sellable unit of this product. NULL means product is not measured in kg (e.g. soap, hair oil bottles where weight is not the relevant unit). Used by /insights/* dashboards.';

-- Coverage check after data entry:
--   select count(*) filter (where weight_kg is not null) as set_count,
--          count(*) as total
--   from products;
