-- =============================================================================
-- 61_tally_beat_map.sql
--
-- STEP 1 of the Tally -> sales-monitor bridge: map each Tally Party Group
-- (per company) to an ERP beat. Creates 2 new beats (Jalna Route, Ambad Road)
-- and the tally_beat_map table.
--
-- Excluded (accounting groups, NOT mapped — no sales targets):
--   Sundry Creditors, Cash-in-hand, Sundry Debtors,
--   Sundry Debtors Long Time Jalna City
-- =============================================================================

-- ---- 1. Create the two new beats under the Jalna area -----------------------
insert into beats (id, name, area_id)
select gen_random_uuid(), 'Jalna Route', (select id from areas where name='Jalna')
where not exists (select 1 from beats where name='Jalna Route');

insert into beats (id, name, area_id)
select gen_random_uuid(), 'Ambad Road', (select id from areas where name='Jalna')
where not exists (select 1 from beats where name='Ambad Road');

-- ---- 2. The mapping table ---------------------------------------------------
create table if not exists tally_beat_map (
  id           uuid primary key default gen_random_uuid(),
  company      text not null,
  party_group  text not null,
  beat_id      uuid not null references beats(id),
  created_at   timestamptz not null default now(),
  unique (company, party_group)
);

-- ---- 3. Seed it -------------------------------------------------------------
insert into tally_beat_map (company, party_group, beat_id) values
  ('Anjali Agencies','S.PUR MEHKAR ROUT','df6843f5-c9ea-4b50-b1e7-d7f5173f7471'::uuid),
  ('Anjali Agencies','LONAR ROUT','86ad10d1-ac2a-4119-9615-2b4b4ab8e37d'::uuid),
  ('Anjali Agencies','D.RAJA.DMAHI ROUT','107f0af7-ebee-4e88-aac0-d483dfda0f4d'::uuid),
  ('Anjali Agencies','Sakharkheda','5d88df9a-ce85-4aea-95d0-bd912fa15091'::uuid),
  ('Anjali Agencies','NEW MONDHA ROUTJALNA','0249a22a-0df6-47f9-92fa-4fe53f8af197'::uuid),
  ('Anjali Agencies','Hiwra Ashram','5d88df9a-ce85-4aea-95d0-bd912fa15091'::uuid),
  ('Anjali Agencies','MERA ANDERA ROUT','79e94ab3-d3c8-4b02-8485-ac366fc743bf'::uuid),
  ('Anjali Agencies','OLD MONDHA & DANA BAZAR ROUT JALNA','13da7093-59b5-46cd-a347-19fb0dfdbacc'::uuid),
  ('Anjali Agencies','New Mondha Shop','0249a22a-0df6-47f9-92fa-4fe53f8af197'::uuid),
  ('Anjali Agencies','Deulgaon Mali','5d88df9a-ce85-4aea-95d0-bd912fa15091'::uuid),
  ('Anjali Agencies','RAMNAGAR ROUT JALNA','7f25f9ab-3a65-43b1-bda0-58aafdae92a3'::uuid),
  ('Anjali Agencies','NUTAN WASAHAT ROUT JALNA','1248b1d4-7de7-4b5d-82b6-e4d44dab6e3f'::uuid),
  ('Anjali Agencies','Mehkar','df6843f5-c9ea-4b50-b1e7-d7f5173f7471'::uuid),
  ('Anjali Agencies','SAKHARKHEDA, LAWALA, HIWRA ASHRAM','5d88df9a-ce85-4aea-95d0-bd912fa15091'::uuid),
  ('Anjali Agencies','JALNA ROUT',((select id from beats where name='Jalna Route'))),
  ('Anjali Agencies','OLD JALNA ROUTJALNA',((select id from beats where name='Ambad Road'))),
  ('Sushil Agencies','NEW MONDHA ROUTJALNA','0249a22a-0df6-47f9-92fa-4fe53f8af197'::uuid),
  ('Sushil Agencies','OLD MONDHA & DANA BAZAR ROUT JALNA','13da7093-59b5-46cd-a347-19fb0dfdbacc'::uuid),
  ('Sushil Agencies','BAZAR LINE OLD JALNA','a48384ba-b22c-43e2-a904-8f144dd2a090'::uuid),
  ('Sushil Agencies','RAMNAGAR ROUT JALNA','7f25f9ab-3a65-43b1-bda0-58aafdae92a3'::uuid),
  ('Sushil Agencies','CHANDAN ZIRA','fc94e7d6-6d40-4a5c-a9aa-9784713aa5f9'::uuid),
  ('Sushil Agencies','NUTAN WASAHAT ROUT JALNA','1248b1d4-7de7-4b5d-82b6-e4d44dab6e3f'::uuid),
  ('Sushil Agencies','S.PUR MEHKAR ROUT','df6843f5-c9ea-4b50-b1e7-d7f5173f7471'::uuid),
  ('Sushil Agencies','SAMBHAJI NAGAR','893fab20-dd64-43a4-a6a4-ea59eaa61cd1'::uuid),
  ('Sushil Agencies','Ramnagar Interiyal','7f25f9ab-3a65-43b1-bda0-58aafdae92a3'::uuid),
  ('Sushil Agencies','New Mondha Shop','0249a22a-0df6-47f9-92fa-4fe53f8af197'::uuid),
  ('Sushil Agencies','NUTAN WASAHAT INTERIYAL-2','75f55639-3408-40f6-8ec0-b94f587174ea'::uuid),
  ('Sushil Agencies','D.RAJA.DMAHI ROUT','107f0af7-ebee-4e88-aac0-d483dfda0f4d'::uuid),
  ('Sushil Agencies','LONAR ROUT','86ad10d1-ac2a-4119-9615-2b4b4ab8e37d'::uuid),
  ('Sushil Agencies','JALNA ROUT',((select id from beats where name='Jalna Route'))),
  ('Sushil Agencies','JALNA CITY ROUT',((select id from beats where name='Jalna Route'))),
  ('Sushil Agencies','OLD JALNA INT',((select id from beats where name='Ambad Road'))),
  ('Sushil Agencies','SAMBHAJI NAGAR','893fab20-dd64-43a4-a6a4-ea59eaa61cd1'::uuid)
on conflict (company, party_group) do update set beat_id = excluded.beat_id;

-- ---- 4. Verify --------------------------------------------------------------
-- select m.company, m.party_group, b.name as beat, a.name as area
-- from tally_beat_map m
-- join beats b on b.id = m.beat_id
-- left join areas a on a.id = b.area_id
-- order by m.company, b.name;
--
-- Unmapped Tally groups (should be only the accounting ones):
-- select distinct company, party_group from tally_sales ts
-- where not exists (select 1 from tally_beat_map m
--   where m.company=ts.company and m.party_group=ts.party_group)
-- order by 1,2;
