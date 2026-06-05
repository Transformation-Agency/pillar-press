# Hedra + ElevenLabs — production handoff (Next.js / Vercel)

This folder is **drop-in server-side code** for the real (non-prototype) Pillar Press
app. It implements the secure version the in-app Studio simulates: API keys stay
server-side, the browser only ever calls your own allowlisted `/api/*` routes, and
media jobs are persisted per-user.

> The in-browser prototype (`screen-studio.jsx`, `studio.js`) **simulates** generation
> so it runs with no server/keys/CORS. This package is what you wire up when you move
> to a real backend. Nothing here runs inside the prototype HTML.

## What's included

```
lib/
  hedra.ts            Typed Hedra client (X-API-Key, error mapping, timeouts) — SERVER ONLY
  elevenlabs.ts       TTS + voices client — SERVER ONLY
  validation.ts       Zod schemas + file/model validation + sanitizers
  errors.ts           Safe error -> HTTP mapping (logs detail, returns generic body)
  auth.ts             getCurrentUser()/requireUser() seam — wire to your real auth
  db.ts               Drizzle client seam
  models-fallback.ts  Fallback catalog when listModels() is unavailable
db/
  schema.ts           Drizzle table: media_jobs
  migration.sql       Equivalent raw SQL migration
app/api/
  hedra/models        GET   live models (filter by type) + fallback
  hedra/credits       GET   credit balance
  hedra/assets        POST  validate + register + upload an image/audio asset
  hedra/generate      POST  validate -> (optional ElevenLabs TTS -> Hedra audio asset) -> generate -> persist job
  hedra/status/[id]   GET   user-scoped poll; persists output URLs; stop on terminal
  eleven/voices       GET   voices for the picker
  media               GET/DELETE  the user's saved jobs (library)
__tests__/hedra.test.ts   vitest: header sent, key never leaks, status->error mapping
```

## Setup

1. Copy `.env.example` to `.env.local` and fill in `HEDRA_API_KEY`, `ELEVENLABS_API_KEY`,
   `DATABASE_URL`. In Vercel, set these as **Environment Variables** (server scope — never
   `NEXT_PUBLIC_`).
2. Apply the migration: run `db/migration.sql` (or `drizzle-kit generate && migrate`).
3. Wire `lib/auth.ts` to your session, and `lib/db.ts` to your existing Drizzle client.
4. Adjust `@/` import aliases to your `tsconfig` paths if needed.
5. `npm i zod drizzle-orm pg && npm i -D vitest @types/pg`. Run `vitest`.

## Security model (acceptance criteria)

- `HEDRA_API_KEY` / `ELEVENLABS_API_KEY` are read only via `process.env` inside server
  route handlers. They are **never** imported into client components, returned in
  responses, logged, or placed in `NEXT_PUBLIC_*`.
- The browser cannot send arbitrary Hedra paths — it calls a fixed set of `/api/*`
  routes; each maps to one allowlisted client function.
- Every route calls `requireUser()` first; `status` and `media` queries are filtered by
  `userId`, so one user can never read another's jobs.
- All request bodies are validated with Zod; uploads are checked for type/size; prompts
  and filenames are sanitized before storage/display.
- Provider error bodies are logged server-side but never forwarded to the client; users
  get generic, secret-free messages (`auth`, `insufficient_credits`, `rate_limit`,
  `validation`, `timeout`, `upstream`).
- Hedra output URLs can be temporary/signed — re-fetch via `status` rather than treating
  stored URLs as permanent.

## The narrated-video flow (image + ElevenLabs audio -> Hedra video)

1. `POST /api/hedra/assets` (kind=image) — upload or generate a start frame.
2. `POST /api/hedra/generate` with `type: "avatar_video"`, the `startAssetId`, a `script`
   and `voiceId`. The route renders the voiceover on **ElevenLabs**, uploads it to Hedra
   as an audio asset, then calls Hedra `generateAsset` with that `audio_asset_id` so the
   video is lip-synced to the audio.
3. Client polls `GET /api/hedra/status/[id]` until `completed`; persist `outputUrl`.
4. Job is saved in `media_jobs` with `sourceContentId = pieceId`, so it appears on that
   piece in the library.

## Polling

Async generation: after `generate`, the client polls `status/[id]` every ~3s and **stops**
on `completed`/`failed`/`canceled`. If you have a queue (e.g. Inngest, QStash), move the
poll server-side and push updates instead — the persisted `media_jobs.status` is the
source of truth either way.
