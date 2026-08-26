-- Recording share-link expiry — the host can set how long a recording's
-- share link stays valid. The underlying R2 object itself is already
-- publicly readable (see r2Config.publicUrl), so this doesn't lock down the
-- raw file — it gates the app-generated share link (GET /recordings/:id/share)
-- that hosts actually copy and send out.
alter table public.recordings add column if not exists share_expires_at timestamptz;
