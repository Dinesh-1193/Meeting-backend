-- Meeting templates — a host saves a named bundle of scheduling defaults
-- (mode, duration, settings) to reapply next time instead of re-entering
-- everything, mirroring Zoom's "meeting templates".
create table if not exists public.meeting_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  mode text not null default 'conference',
  duration_minutes integer not null default 30,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists meeting_templates_owner_idx on public.meeting_templates (owner_id);

alter table public.meeting_templates enable row level security;

drop policy if exists "meeting_templates_select_authenticated" on public.meeting_templates;
create policy "meeting_templates_select_authenticated" on public.meeting_templates
  for select to authenticated using (true);
