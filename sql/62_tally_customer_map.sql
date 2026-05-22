-- =============================================================================
-- 62_tally_customer_map.sql
--
-- STEP 2 of the bridge: match each Tally party_name to an ERP customer, scoped
-- to the beat that the party's Tally group maps to (tally_beat_map). Beat-scoping
-- makes matching far more accurate — "Vishal Kirana" only competes with shops in
-- the same beat, not the whole city.
--
-- Uses pg_trgm similarity on normalized names. Produces tally_customer_map with
-- a confidence score and a status:
--   'auto'   high confidence (sim >= 0.55)         -> accepted automatically
--   'review' medium (0.30 <= sim < 0.55)           -> you confirm/fix
--   'none'   no candidate in beat (sim < 0.30)     -> unmatched, you handle
--
-- Re-runnable. Does NOT touch customers or targets — just builds the map.
-- =============================================================================

create extension if not exists pg_trgm;

-- ---- Name normalizer (shared shape with the ingest matcher) -----------------
create or replace function tally_norm_name(s text)
returns text language sql immutable as $$
  select trim(regexp_replace(
    regexp_replace(
      lower(coalesce(s,'')),
      '\m(kirana|kirna|stores?|store|general|ganral|genral|provision|traders?|treaders?|teaders?|and|company|co|the|shop|shopee|shopi|supar|super|mart|market|m/s)\M',
      ' ', 'g'
    ),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

-- ---- The map table ----------------------------------------------------------
create table if not exists tally_customer_map (
  id           uuid primary key default gen_random_uuid(),
  company      text not null,
  party_name   text not null,
  beat_id      uuid references beats(id),
  customer_id  uuid references customers(id),
  confidence   numeric,
  status       text not null default 'none',   -- auto | review | none | manual
  created_at   timestamptz not null default now(),
  unique (company, party_name)
);

-- ---- Build / refresh the matches -------------------------------------------
-- For each distinct (company, party_name) -> its mapped beat -> best customer
-- in that beat by trigram similarity on normalized names.
create or replace function tally_build_customer_map()
returns table(matched_auto int, needs_review int, unmatched int)
language plpgsql as $$
declare
  v_auto int := 0; v_review int := 0; v_none int := 0;
  r record;
  v_best_id uuid;
  v_best_sim numeric;
  v_status text;
begin
  -- clear existing auto/none/review (keep manual overrides)
  delete from tally_customer_map where status <> 'manual';

  for r in
    select distinct ts.company, ts.party_name, m.beat_id
    from tally_sales ts
    join tally_beat_map m on m.company = ts.company and m.party_group = ts.party_group
    where ts.party_name is not null
      and not exists (  -- skip ones already pinned manually
        select 1 from tally_customer_map cm
        where cm.company = ts.company and cm.party_name = ts.party_name and cm.status='manual'
      )
  loop
    -- best customer in the same beat
    select c.id,
           similarity(tally_norm_name(r.party_name), tally_norm_name(c.name)) as sim
      into v_best_id, v_best_sim
    from customers c
    where c.active = true
      and c.beat_id = r.beat_id
    order by similarity(tally_norm_name(r.party_name), tally_norm_name(c.name)) desc
    limit 1;

    if v_best_sim is null then v_best_sim := 0; end if;

    if v_best_sim >= 0.55 then v_status := 'auto'; v_auto := v_auto + 1;
    elsif v_best_sim >= 0.30 then v_status := 'review'; v_review := v_review + 1;
    else v_status := 'none'; v_none := v_none + 1; v_best_id := null;
    end if;

    insert into tally_customer_map (company, party_name, beat_id, customer_id, confidence, status)
    values (r.company, r.party_name, r.beat_id,
            case when v_status='none' then null else v_best_id end,
            round(v_best_sim,3), v_status)
    on conflict (company, party_name) do update
      set beat_id=excluded.beat_id, customer_id=excluded.customer_id,
          confidence=excluded.confidence, status=excluded.status;
  end loop;

  return query select v_auto, v_review, v_none;
end;
$$;

-- =============================================================================
-- RUN:
--   select * from tally_build_customer_map();
--
-- Then review summary:
--   select status, count(*) from tally_customer_map group by status;
--
-- See the 'review' + 'none' ones (the work list) with the candidate name:
--   select cm.company, b.name beat, cm.party_name,
--          c.name as matched_customer, cm.confidence, cm.status
--   from tally_customer_map cm
--   join beats b on b.id=cm.beat_id
--   left join customers c on c.id=cm.customer_id
--   where cm.status in ('review','none')
--   order by cm.status, b.name, cm.confidence desc;
-- =============================================================================
