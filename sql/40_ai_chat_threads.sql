-- ============================================================================
-- 40 — AI chat threads and messages
--
-- Persists chat conversations between users and the AI assistant.
-- Each thread is owned by one app_user; messages alternate user/assistant.
-- ============================================================================

create table if not exists ai_chat_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_users(id) on delete cascade,
  title       text,                  -- Auto-generated from first user message
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Soft-delete by hiding rather than removing (so we can audit costs)
  archived    boolean not null default false
);

create index if not exists ai_chat_threads_user_idx
  on ai_chat_threads (user_id, updated_at desc);

create table if not exists ai_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references ai_chat_threads(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'system')),
  content     text not null,
  -- For assistant messages, track token usage and cost
  model       text,
  prompt_tokens int,
  completion_tokens int,
  cost_usd    numeric(10,6),
  -- Optional: the context we sent (JSON of pulled DB data, for debugging)
  context_meta jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ai_chat_messages_thread_idx
  on ai_chat_messages (thread_id, created_at);

-- RLS: users only see their own threads
alter table ai_chat_threads enable row level security;
alter table ai_chat_messages enable row level security;

drop policy if exists "users read own threads" on ai_chat_threads;
create policy "users read own threads"
  on ai_chat_threads for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "users read own messages" on ai_chat_messages;
create policy "users read own messages"
  on ai_chat_messages for select to authenticated
  using (exists (select 1 from ai_chat_threads where id = thread_id and user_id = auth.uid()));

-- Updates happen via service role
