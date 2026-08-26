-- Meeting passcode — a separate, optional gate from the waiting room. Plain
-- text by design: it's a short shareable convenience code (like Zoom's PMI
-- passcode), not a security credential, and the host needs to be able to
-- read it back to share it.
alter table public.rooms add column if not exists passcode text;
