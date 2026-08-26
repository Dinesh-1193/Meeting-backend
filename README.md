# MeetSpace Backend

Node.js / Express API for MeetSpace. Uses **Supabase** (Auth + Postgres) and **LiveKit** (meeting tokens).

## Stack

| Layer | Tech |
|--------|------|
| Runtime | Node 18+, Express, TypeScript |
| Auth / DB | Supabase Auth + Postgres |
| Video | LiveKit (`livekit-server-sdk`) |
| Chat realtime | Centrifugo (optional) |
| Email | Resend (optional; logs when unset) |
| Storage | Cloudflare R2 (optional recordings/avatars) |
| Validation | Zod |

## Quick start

1. Run SQL migrations `supabase/migrations/001_*.sql` → `015_*.sql` in order.
2. `cp .env.example .env` and fill Supabase + LiveKit (plus optional Resend/R2/Centrifugo).
3. `npm install && npm run dev` → `http://localhost:4000`

Health: `GET /health`

## API surface (high level)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | — | Create user + profile |
| POST | `/auth/login` | — | Email/password |
| POST | `/auth/refresh` | — | Rotate access token |
| POST | `/auth/logout` | Bearer | Revoke sessions |
| GET/PATCH | `/auth/me` | Bearer | Profile |
| POST | `/auth/me/avatar` | Bearer | Avatar upload (R2) |
| POST | `/auth/forgot-password` | — | Reset email |
| POST | `/auth/reset-password` | — | Set new password |
| POST | `/auth/oauth/google` | — | Exchange Google session |
| POST | `/auth/guest` | — | Guest JWT for one room |
| POST | `/rooms` | Registered | Instant/scheduled meeting (+ invite emails) |
| GET | `/rooms/:id` | Bearer/guest | Room details |
| POST | `/rooms/:id/token` | Bearer/guest | LiveKit JWT |
| GET | `/users/:id/meetings` | Registered | Paginated meetings |
| GET | `/recordings` | Registered | Paginated recordings |
| GET | `/contacts` | Registered | Contacts + presence |
| GET | `/notifications` | Registered | In-app notifications |
| POST | `/presence/heartbeat` | Registered | Presence ping |
| * | `/chat/*` | Registered | Persistent chat (Centrifugo) |
| POST | `/webhooks/livekit` | LiveKit | Egress / recording updates |

List endpoints accept `?limit=&cursor=` and return `{ items, nextCursor }`.

### Auth header

```http
Authorization: Bearer <access_or_guest_token>
```

Guest tokens are room-scoped and cannot access dashboard routes.
