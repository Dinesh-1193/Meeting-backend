-- Complete the scheduling window: description, timezone, invitees, recurrence, cancellation.

alter table public.rooms
  add column if not exists description text,
  add column if not exists timezone text,
  add column if not exists invited_emails jsonb not null default '[]',
  add column if not exists recurrence_rule text,
  add column if not exists recurrence_group_id uuid,
  add column if not exists cancelled_at timestamptz;

create index if not exists rooms_recurrence_group_idx
  on public.rooms (recurrence_group_id);
