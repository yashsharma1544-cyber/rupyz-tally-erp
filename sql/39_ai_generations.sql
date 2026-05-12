-- ============================================================================
-- 39 — AI generations cache
--
-- Stores Claude-generated narratives, briefings, and metadata. Used as a
-- read-through cache so we don't pay for identical generations.
--
-- Cache key: (feature, entity_type, entity_id, scope_date)
-- - feature: 'customer_narrative' | 'beat_narrative' | 'product_narrative' | 'daily_briefing' | 'chat_turn'
-- - entity_type/entity_id: the customer/beat/product UUID for narratives, null for briefings/chat
-- - scope_date: the date the analysis is anchored to (so cache regenerates daily)
--
-- context_hash is a SHA-1 of the input data. If the underlying data changes
-- (new orders, new visits), the hash changes and the cache miss forces
-- regeneration.
-- ============================================================================

create table if not exists ai_generations (
  id uuid primary key default gen_random_uuid(),
  feature           text not null,
  entity_type       text,
  entity_id         uuid,
  scope_date        date not null default current_date,
  model             text not null,
  prompt_tokens     int  not null default 0,
  completion_tokens int  not null default 0,
  content           text not null,
  context_hash      text,
  -- Cost in USD for monitoring (calculated client-side, stored for audit)
  cost_usd          numeric(10,6),
  created_at        timestamptz not null default now()
);

-- Latest generation wins per (feature, entity, date)
create unique index if not exists ai_generations_key 
  on ai_generations (feature, coalesce(entity_type, ''), coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), scope_date);

-- For listing recent generations / cost tracking
create index if not exists ai_generations_created_at_idx 
  on ai_generations (created_at desc);

-- RLS: only admins can read AI generations (they may contain sensitive insights)
alter table ai_generations enable row level security;

drop policy if exists "admins read ai_generations" on ai_generations;
create policy "admins read ai_generations" 
  on ai_generations for select to authenticated
  using (exists (select 1 from app_users where id = auth.uid() and role = 'admin'));

-- Note: writes happen via service role (server-side API routes), no policy needed
