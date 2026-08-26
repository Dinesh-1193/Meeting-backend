-- Fix: decided_by/requested_by referenced profiles without an ON DELETE action,
-- which blocked deleting a user account once they'd ever admitted/denied a
-- join request or started a recording (discovered during verification).

alter table public.room_participants
  drop constraint if exists room_participants_decided_by_fkey,
  add constraint room_participants_decided_by_fkey
    foreign key (decided_by) references public.profiles (id) on delete set null;

alter table public.recordings
  drop constraint if exists recordings_requested_by_fkey,
  add constraint recordings_requested_by_fkey
    foreign key (requested_by) references public.profiles (id) on delete set null;
