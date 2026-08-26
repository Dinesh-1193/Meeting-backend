-- Host controls completeness: meeting lock, co-host role.

alter table public.rooms add column if not exists is_locked boolean not null default false;

alter table public.room_participants
  drop constraint if exists room_participants_role_check,
  add constraint room_participants_role_check
    check (role in ('host', 'cohost', 'panelist', 'attendee'));
