-- Alternate hosts — pre-assigned at scheduling time by email (mirrors
-- invited_emails). Anyone in this list gets full host privileges when they
-- join, without changing rooms.host_id (which stays the original scheduler
-- for ownership/edit-series purposes).
alter table public.rooms add column if not exists alternate_hosts jsonb not null default '[]';
