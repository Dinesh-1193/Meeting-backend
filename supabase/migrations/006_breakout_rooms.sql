-- Breakout rooms: each breakout is also a normal `rooms` row (reuses the
-- existing token/join pipeline unmodified); these two tables track parent
-- linkage, lifecycle, and participant assignment for the host's panel.

create table if not exists public.breakout_rooms (
  id text primary key,
  parent_room_id text not null references public.rooms (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists breakout_rooms_parent_idx
  on public.breakout_rooms (parent_room_id);

create table if not exists public.breakout_assignments (
  breakout_room_id text not null references public.breakout_rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (breakout_room_id, user_id)
);

alter table public.breakout_rooms enable row level security;
alter table public.breakout_assignments enable row level security;

drop policy if exists "breakout_rooms_select_authenticated" on public.breakout_rooms;
create policy "breakout_rooms_select_authenticated" on public.breakout_rooms
  for select to authenticated using (true);

drop policy if exists "breakout_assignments_select_own" on public.breakout_assignments;
create policy "breakout_assignments_select_own" on public.breakout_assignments
  for select to authenticated using (
    auth.uid() = user_id
    or exists (
      select 1 from public.breakout_rooms br
      join public.rooms r on r.id = br.parent_room_id
      where br.id = breakout_room_id and r.host_id = auth.uid()
    )
  );
