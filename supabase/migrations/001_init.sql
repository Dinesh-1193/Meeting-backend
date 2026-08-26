-- MeetSpace schema for Supabase
-- Run in Supabase SQL Editor (or via CLI migration).

-- Extensions
create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Rooms / meetings
create table if not exists public.rooms (
  id text primary key,
  name text not null,
  host_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'waiting'
    check (status in ('scheduled', 'waiting', 'live', 'ended')),
  join_code text not null unique,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  duration_minutes integer,
  participant_count integer not null default 0,
  is_personal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists rooms_host_id_idx on public.rooms (host_id);
create index if not exists rooms_status_idx on public.rooms (status);
create index if not exists rooms_scheduled_at_idx on public.rooms (scheduled_at);

-- Cloud recordings metadata (actual media usually on LiveKit egress / storage)
create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms (id) on delete cascade,
  url text,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'failed')),
  duration_seconds integer,
  created_at timestamptz not null default now()
);

create index if not exists recordings_room_id_idx on public.recordings (room_id);

-- Persistent room chat (optional alongside LiveKit data messages)
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_room_id_idx
  on public.chat_messages (room_id, created_at);

-- Contact graph
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  contact_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_id, contact_user_id),
  check (owner_id <> contact_user_id)
);

create index if not exists contacts_owner_id_idx on public.contacts (owner_id);

-- Auto-create profile on auth signup (when using Supabase Auth UI or OAuth)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email, 'user'), '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    name = coalesce(nullif(excluded.name, ''), public.profiles.name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security (API uses service role; enable RLS for direct client access safety)
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.recordings enable row level security;
alter table public.chat_messages enable row level security;
alter table public.contacts enable row level security;

-- Profiles: users can read all profiles; update own
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Rooms: authenticated users can read; hosts manage their rooms
drop policy if exists "rooms_select_authenticated" on public.rooms;
create policy "rooms_select_authenticated" on public.rooms
  for select to authenticated using (true);

drop policy if exists "rooms_insert_host" on public.rooms;
create policy "rooms_insert_host" on public.rooms
  for insert to authenticated with check (auth.uid() = host_id);

drop policy if exists "rooms_update_host" on public.rooms;
create policy "rooms_update_host" on public.rooms
  for update to authenticated using (auth.uid() = host_id);

-- Recordings: host can manage; anyone auth can read for discovery
drop policy if exists "recordings_select_authenticated" on public.recordings;
create policy "recordings_select_authenticated" on public.recordings
  for select to authenticated using (true);

drop policy if exists "recordings_insert_host" on public.recordings;
create policy "recordings_insert_host" on public.recordings
  for insert to authenticated
  with check (
    exists (
      select 1 from public.rooms r
      where r.id = room_id and r.host_id = auth.uid()
    )
  );

-- Chat: participants can insert as themselves; anyone auth can read
drop policy if exists "chat_select_authenticated" on public.chat_messages;
create policy "chat_select_authenticated" on public.chat_messages
  for select to authenticated using (true);

drop policy if exists "chat_insert_own" on public.chat_messages;
create policy "chat_insert_own" on public.chat_messages
  for insert to authenticated with check (auth.uid() = sender_id);

-- Contacts: owner only
drop policy if exists "contacts_select_own" on public.contacts;
create policy "contacts_select_own" on public.contacts
  for select to authenticated using (auth.uid() = owner_id);

drop policy if exists "contacts_insert_own" on public.contacts;
create policy "contacts_insert_own" on public.contacts
  for insert to authenticated with check (auth.uid() = owner_id);

drop policy if exists "contacts_delete_own" on public.contacts;
create policy "contacts_delete_own" on public.contacts
  for delete to authenticated using (auth.uid() = owner_id);
