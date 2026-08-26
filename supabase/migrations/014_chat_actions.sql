-- Chat & message actions: mute/pin/leave a conversation, and per-message
-- copy/reactions/edit/reply/forward/attachments. Extends the persistent
-- chat module from 013_chat_module.sql; no changes to the in-meeting chat.

alter table public.chat_channel_members
  add column if not exists muted boolean not null default false,
  add column if not exists pinned_at timestamptz;

alter table public.chat_channel_messages
  add column if not exists reply_to_message_id uuid references public.chat_channel_messages(id) on delete set null,
  add column if not exists forwarded_from_sender_name text;

create table if not exists public.chat_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_channel_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create index if not exists chat_message_reactions_message_id_idx
  on public.chat_message_reactions (message_id);

alter table public.chat_message_reactions enable row level security;
drop policy if exists "chat_message_reactions_select_all" on public.chat_message_reactions;
create policy "chat_message_reactions_select_all" on public.chat_message_reactions
  for select to authenticated using (true);

create table if not exists public.chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_channel_messages(id) on delete cascade,
  filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  url text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_message_attachments_message_id_idx
  on public.chat_message_attachments (message_id);

alter table public.chat_message_attachments enable row level security;
drop policy if exists "chat_message_attachments_select_all" on public.chat_message_attachments;
create policy "chat_message_attachments_select_all" on public.chat_message_attachments
  for select to authenticated using (true);
