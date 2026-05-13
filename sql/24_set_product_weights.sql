-- ============================================================================
-- 24 — Set weight_kg on existing 45 products
--
-- Derived from the Excel Items_Weight_Conversion.xlsx, given that:
--   • Rupyz orders always set unit='Kg' regardless of what qty really means
--   • For weight-tier SKUs (named '1 Kg', '250 Gm', etc.), qty is literally kg
--     → weight_kg = 1.0  (so view's `qty * weight_kg = qty kg`)
--   • For price-tier SKUs (named 'Rs 10', 'Rs 20', etc.), qty is pkts
--     → weight_kg = std_weight_kg / pack_count  (per-pkt weight in kg)
--
-- 43 of 45 matched cleanly. 2 unresolved (see note at bottom).
-- ============================================================================

begin;

-- Janta Dust 5 Kg  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'e7b270a7-2c25-4f90-8d69-568b120b963b';
-- Lion no.05 1 Kg- Bag Free  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'c5f3b2b1-abfa-4726-9b1e-e23ff4b04d56';
-- Lion no.05 100 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'ccfc13bb-54f2-4753-8b8f-5d398c3f751d';
-- Lion no.05 250 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'd3ab0acf-8970-45f2-a2ec-97fd613bafdf';
-- Lion no.05 500 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '78567323-f38d-4f75-99f2-9ea0566be58d';
-- Lion no.05 Rs 10  (price-tier Rs.10, 0.624 kg/pkt from Excel)
update products set weight_kg = 0.6240 where id = '330aa4e4-8f12-4274-a356-eb7d83d4635f';
-- Lion no.05 Rs 20  (price-tier Rs.20, 0.96 kg/pkt from Excel)
update products set weight_kg = 0.9600 where id = 'f37fcb6f-c5fa-4f2c-9d3c-c8af6983f82f';
-- Lion no.05 Rs 5  (price-tier Rs.5, 0.6 kg/pkt from Excel)
update products set weight_kg = 0.6000 where id = 'dd840222-f599-4b72-b36c-6e7f32fdd2f4';
-- New Sagar 5 Kg  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'a585468d-7c92-44a5-b631-b721cfe54400';
-- Rupa Premium Mix 500 Gm Tin  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'aa78ec79-2c89-47cd-bcd1-257fdd64ce97';
-- Vikram Elaichi Dust 1 Kg  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'f0fb6951-f441-4b6d-90c7-cf693ee10516';
-- Vikram Elaichi Dust 100 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '1c6ca539-df2b-444f-88c1-53e7c10ff5b9';
-- Vikram Elaichi Dust 250 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '6a9d16d0-88e2-450e-88d9-e01b9a6e5c35';
-- Vikram Elaichi Dust 250 Gm Jar  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '94c63c84-170b-4917-937a-ae434080e42b';
-- Vikram Elaichi Dust 500 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'fe0ddf3e-e87e-4ae3-b959-6c87e6588292';
-- Vikram Elaichi Dust Rs 10  (price-tier Rs.10, 0.528 kg/pkt from Excel)
update products set weight_kg = 0.5280 where id = 'fbc8ac31-e5ea-4ca8-982b-c775a83910b4';
-- Vikram Elaichi Dust Rs 20  (price-tier Rs.20, 0.576 kg/pkt from Excel)
update products set weight_kg = 0.5760 where id = 'ac0d22c8-93c4-46f7-b269-f5313aa6ab63';
-- Vikram Gold Mix 1 Kg Jar  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'afee1eea-0322-40a7-bb62-7d639160b02e';
-- Vikram Gold Mix 1 Kg Standee  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '0d5cc99a-6e68-4515-ab7b-b84f2eca1ea9';
-- Vikram Gold Mix 100 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '98c9e226-3613-4623-bf54-daa86a962e23';
-- Vikram Gold Mix 250 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'c7cff2ae-8200-45d9-b906-65a71075adea';
-- Vikram Gold Mix 500 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'afe7c731-4e3a-421a-9029-3b7b4436dbe7';
-- Vikram Gold Mix Rs 10  (price-tier Rs.10, 0.288 kg/pkt from Excel)
update products set weight_kg = 0.2880 where id = 'eaea3bfc-4988-4d89-9f6e-db1152a1461c';
-- Vikram Gold Mix Rs 20  (price-tier Rs.20, 0.288 kg/pkt from Excel)
update products set weight_kg = 0.2880 where id = '0ae139a9-ce40-4020-a4c9-32e2be18a3b5';
-- Vikram Gold Mix Rs 5  (price-tier Rs.5, 0.288 kg/pkt from Excel)
update products set weight_kg = 0.2880 where id = '62f11a62-7e54-4e30-b3c0-6158995b7a3d';
-- Vikram Green Tea 100 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'd776e4d6-e347-4157-9085-445f8789e4cd';
-- Vikram Green Tea Dip Dip 50gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'f39baaa3-f184-4630-b428-89872efe5ee6';
-- Vikram Kadak Dust 1 Kg  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '3c175f6a-b9fb-421d-889f-dcac3465a247';
-- Vikram Kadak Dust 100 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'b2006bf8-2b16-425c-b0b3-686f51628160';
-- Vikram Kadak Dust 200 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '4ff98d47-8837-4b99-a8c5-e5c13b7dd701';
-- Vikram Kadak Dust 250 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '06b830ff-a4c3-4dcf-9a52-6edea81adadc';
-- Vikram Kadak Dust 5 Kg  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '4261d9d9-b6e9-4840-b343-035731e2194b';
-- Vikram Kadak Dust 5 Kg  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '896c759a-37dc-4880-beb8-8bc180074673';
-- Vikram Kadak Dust 500 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '37ffd74d-2798-4add-a8ba-8b70d3ada2a8';
-- Vikram Kadak Dust Rs 10  (price-tier Rs.10, 0.598 kg/pkt from Excel)
update products set weight_kg = 0.5980 where id = '09e2552a-8b88-4364-993f-862707cb71a3';
-- Vikram Kadak Dust Rs 20  (price-tier Rs.20, 0.94 kg/pkt from Excel)
update products set weight_kg = 0.9400 where id = '6da19be6-6649-4c71-83d8-77d6b08225ab';
-- Vikram Lion (N) 1 Kg  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '8d1cdbe3-2003-4780-927b-c4432d64dafe';
-- Vikram Lion (N) 1 Kg Tub Free  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '9138dab1-ca8e-40ba-8f31-f8874069ee1b';
-- Vikram Lion (N) 100 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'fe17c97c-6313-42f7-ba88-4b5bbd30045f';
-- Vikram Lion (N) 250 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'ae7d4a4a-e95c-49af-9cf5-37b905626bac';
-- Vikram Lion (N) 500 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = 'b613b508-acf4-45a3-8dcb-da0b22d64c73';
-- Vikram Lion (N) Rs 10  (price-tier Rs.10, 0.312 kg/pkt from Excel)
update products set weight_kg = 0.3120 where id = 'bd1bdbe4-745f-43fc-a8f0-28c7706f98f7';
-- Vikram Masala 250 Gm  (weight-tier (qty=kg, multiplier=1.0))
update products set weight_kg = 1.0000 where id = '49d77708-d8c0-418c-aee3-28f4d028863c';

-- ============================================================================
-- UNRESOLVED (2 rows) — review and update manually if you want them counted:
--
--   id='7276fa93-f3da-431f-8288-94b14bd7451f' name='Rs 5'
--   id='aba73eca-ace8-4d75-ae31-f5e9bae31e59' name='Rs 5 Vikram Kadak Dust'
--
-- These appear to be data entry errors / partial duplicates of properly-named
-- products. If you confirm they map to 'Vikram Kadak Dust Rs 5' (weight 0.6 kg/pkt),
-- run these too:
--   update products set weight_kg = 0.6000 where id = '7276fa93-f3da-431f-8288-94b14bd7451f';
--   update products set weight_kg = 0.6000 where id = 'aba73eca-ace8-4d75-ae31-f5e9bae31e59';
-- ============================================================================

commit;

-- Verify after running:
--   select count(*) filter (where weight_kg is not null) as set_count,
--          count(*) as total
--   from products;