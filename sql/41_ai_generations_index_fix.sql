-- ============================================================================
-- 41 — Fix ai_generations unique index for ON CONFLICT
--
-- The original index in sql/39 used coalesce(entity_id, '00000...') to
-- handle nulls, but expression indexes can't be referenced in ON CONFLICT
-- by column name. Replace with a regular composite unique index.
--
-- Cost of this change: if two concurrent requests with null entity_id 
-- both miss cache simultaneously, they could both insert a row. Worst case:
-- we pay 2x for one cache miss. Negligible — and Sonnet calls cost ~1 cent
-- each.
-- ============================================================================

drop index if exists ai_generations_key;

create unique index ai_generations_key 
  on ai_generations (feature, entity_type, entity_id, scope_date)
  where entity_id is not null;

-- For null entity_id (briefings, chat), separate partial unique index
create unique index if not exists ai_generations_key_null_entity
  on ai_generations (feature, scope_date)
  where entity_id is null;
