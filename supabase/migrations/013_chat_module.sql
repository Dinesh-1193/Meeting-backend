-- Persistent chat module (DMs + group chats), separate from the existing
-- in-meeting chat (chat_messages / rooms.service.ts sendChat/listChat, which
-- stays untouched and meeting-scoped). This module is standalone: channels
-- persist across sessions, real-time delivery goes over Centrifugo
-- (see docker-compose.yml), and history is paginated via keyset (seq).
--
-- Table names are deliberately distinct from `chat_messages` (in-meeting)
-- to avoid any collision: chat_channels / chat_channel_members /
-- chat_channel_messages.
--
-- RLS: enabled with a single permissive `select ... using (true)` policy,
-- matching this codebase's convention (see rooms/recordings migrations) —
-- the backend exclusively uses the service-role key, so RLS isn't the real
-- access-control layer here. Real authorization is the membership check in
-- chat.service.ts (assertChannelMember), mirroring assertModerator/assertHost
-- in backend/src/lib/authorization.ts.

create table if not exists public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('dm', 'group')),
  dm_key text,
  name text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  last_message_seq bigint not null default 0,
  last_message_preview text,
  last_message_sender_id uuid references public.profiles(id) on delete set null,
  last_message_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_channels_dm_no_name check (type <> 'dm' or name is null),
  constraint chat_channels_group_no_dm_key check (type <> 'group' or dm_key is null)
);

-- Prevents duplicate DM channels between the same two users.
create unique index if not exists chat_channels_dm_key_idx
  on public.chat_channels (dm_key)
  where type = 'dm';

create index if not exists chat_channels_updated_at_idx
  on public.chat_channels (updated_at desc);

alter table public.chat_channels enable row level security;
drop policy if exists "chat_channels_select_all" on public.chat_channels;
create policy "chat_channels_select_all" on public.chat_channels
  for select to authenticated using (true);

create table if not exists public.chat_channel_members (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_seq bigint not null default 0,
  joined_at timestamptz not null default now(),
  unique (channel_id, user_id)
);

create index if not exists chat_channel_members_user_id_idx
  on public.chat_channel_members (user_id);

alter table public.chat_channel_members enable row level security;
drop policy if exists "chat_channel_members_select_all" on public.chat_channel_members;
create policy "chat_channel_members_select_all" on public.chat_channel_members
  for select to authenticated using (true);

create table if not exists public.chat_channel_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null,
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create unique index if not exists chat_channel_messages_seq_idx
  on public.chat_channel_messages (seq);

-- Keyset pagination: fetch a page for a channel ordered newest-first.
create index if not exists chat_channel_messages_channel_seq_idx
  on public.chat_channel_messages (channel_id, seq desc);

alter table public.chat_channel_messages enable row level security;
drop policy if exists "chat_channel_messages_select_all" on public.chat_channel_messages;
create policy "chat_channel_messages_select_all" on public.chat_channel_messages
  for select to authenticated using (true);
