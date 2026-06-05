# Pillar Press — Backend Build Package (for Claude Code)

This bundle is everything needed to build the **production backend** for Pillar Press,
an editorial workstation that runs writers' drafts through AI review "gates," generates
platform-native posts, weaves many files into one piece, and produces media
(Hedra video + ElevenLabs audio). A working **front-end prototype already exists** — this
package tells you what to build behind it.

## Read in this order

1. **`CLAUDE.md`** — how to work in this repo (conventions, ground rules, do/don't).
2. **`BUILD_BRIEF.md`** — the full scope: every feature and its server-side requirements.
3. **`DATA_MODEL.md`** — entities, fields, relationships, migrations.
4. **`API_SPEC.md`** — the endpoints to implement, grouped by feature.
5. **`server/`** — a real, partial scaffold you should extend (Hedra/ElevenLabs media is
   already written here as the reference implementation for *all* the integration code).
6. **`prototype-reference/`** — the actual front-end prototype source. **The AI prompts,
   data shapes, and business rules are defined here and must be ported verbatim.** These
   are plain `.js` files (browser globals); your job is to move their logic server-side.

## What exists vs. what to build

| Layer | Status |
|---|---|
| Front-end UX (all screens, flows, components) | ✅ Built (the prototype). Re-point its `fetch`/simulated calls at your new API. |
| AI prompt logic for gates / weave / generators / revision | ✅ Written (in `prototype-reference/*.js`) — **port these prompts exactly**, move the model call server-side. |
| Hedra + ElevenLabs media backend | 🟡 Reference implementation in `server/` — finish wiring auth/db and deploy. |
| Auth, database, persistence for everything else | ❌ Build it (the prototype uses browser `localStorage`; you replace that with real APIs). |

## The core architectural change

The prototype is **client-only**: all state is in `localStorage`, and the only AI it calls
is a browser helper (`window.claude.complete`). Your job is to build the server that:

- holds the real data (campaigns, pieces, references, media, settings) in Postgres,
- runs the AI passes server-side (so API keys stay server-side),
- owns the third-party integrations (Anthropic, Hedra, ElevenLabs, Google Drive),
- enforces auth + per-user/workspace authorization.

The front-end then calls your API instead of `localStorage` + `window.claude.complete`.

## Target stack (from the product owner)

**Next.js (App Router) on Vercel, Postgres + Drizzle, Zod validation.** The `server/`
scaffold is already in this shape. If you have a strong reason to differ, raise it first.

## Environment

See `server/.env.example`. Secrets are **server-only** (never `NEXT_PUBLIC_*`):
`ANTHROPIC_API_KEY`, `HEDRA_API_KEY`, `ELEVENLABS_API_KEY`, `DATABASE_URL`, plus Google
OAuth client credentials for Drive.
