-- Polls and Q&A were data-channel-only (lost on refresh/reconnect). Persist
-- them the same way chat already is, while still broadcasting live for
-- real-time UX — the DB row is the source of truth for history.

create table if not exists public.polls (
  id text primary key,
  room_id text not null references public.rooms (id) on delete cascade,
  question text not null,
  options jsonb not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists polls_room_id_idx on public.polls (room_id, created_at);

create table if not exists public.poll_votes (
  poll_id text not null references public.polls (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  option_id text not null,
  voted_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create table if not exists public.qa_questions (
  id text primary key,
  room_id text not null references public.rooms (id) on delete cascade,
  text text not null,
  asked_by_id uuid references public.profiles (id) on delete set null,
  asked_by_name text not null,
  answered boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists qa_questions_room_id_idx on public.qa_questions (room_id, created_at);

create table if not exists public.qa_upvotes (
  question_id text not null references public.qa_questions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (question_id, user_id)
);

alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
alter table public.qa_questions enable row level security;
alter table public.qa_upvotes enable row level security;

drop policy if exists "polls_select_authenticated" on public.polls;
create policy "polls_select_authenticated" on public.polls
  for select to authenticated using (true);

drop policy if exists "poll_votes_select_authenticated" on public.poll_votes;
create policy "poll_votes_select_authenticated" on public.poll_votes
  for select to authenticated using (true);

drop policy if exists "qa_questions_select_authenticated" on public.qa_questions;
create policy "qa_questions_select_authenticated" on public.qa_questions
  for select to authenticated using (true);

drop policy if exists "qa_upvotes_select_authenticated" on public.qa_upvotes;
create policy "qa_upvotes_select_authenticated" on public.qa_upvotes
  for select to authenticated using (true);
