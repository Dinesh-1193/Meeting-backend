-- Breakout room timer + host broadcast message. Breakout-room participants
-- are connected to a different LiveKit room than the parent, so neither of
-- these can travel over the parent's data channel — they're delivered by
-- piggybacking on the existing per-breakout-room status poll (GET /rooms/:id),
-- mirrored from the parent onto every active breakout child room.
alter table public.rooms add column if not exists breakout_deadline timestamptz;
alter table public.rooms add column if not exists broadcast_message text;
alter table public.rooms add column if not exists broadcast_message_id text;
