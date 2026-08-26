-- MeetSpace large-scale meeting features: webinar mode, waiting room, roles, recording metadata
-- Run in Supabase SQL Editor after 001_init.sql.

alter table public.rooms
  add column if not exists mode text not null default 'conference'
    check (mode in ('conference', 'webinar'));

create table if not exists public.room_participants (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  display_name text not null,
  role text not null default 'attendee'
    check (role in ('host', 'panelist', 'attendee')),
  status text not null default 'pending'
    check (status in ('pending', 'admitted', 'denied', 'joined', 'left')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),
  joined_at timestamptz,
  left_at timestamptz,
  unique (room_id, user_id)
);

create index if not exists room_participants_room_status_idx
  on public.room_participants (room_id, status);

alter table public.recordings
  add column if not exists egress_id text unique,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists requested_by uuid references public.profiles (id);

alter table public.room_participants enable row level security;

drop policy if exists "room_participants_select_authenticated" on public.room_participants;
create policy "room_participants_select_authenticated" on public.room_participants
  for select to authenticated using (true);

drop policy if exists "room_participants_insert_own" on public.room_participants;
create policy "room_participants_insert_own" on public.room_participants
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "room_participants_update_host" on public.room_participants;
create policy "room_participants_update_host" on public.room_participants
  for update to authenticated using (
    exists (
      select 1 from public.rooms r
      where r.id = room_id and r.host_id = auth.uid()
    )
  );
