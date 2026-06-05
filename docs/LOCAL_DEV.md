# Local development

## Prerequisites
- Node 20+ (built on 24), Docker, and the Supabase CLI (`brew install supabase/tap/supabase`).

## Start the stack
```bash
supabase start                 # local Postgres (:54322) + GoTrue auth (:54321)
npm install
cp .env.example .env           # then fill in keys (see below)
npm run db:migrate             # apply Drizzle migrations
npm run dev                    # http://localhost:3000
```
`supabase status` prints the DB URL + keys to paste into `.env`.

## Environment keys
Fill these in `.env` (gitignored, server-only — never `NEXT_PUBLIC_` a secret):
- `ANTHROPIC_API_KEY` — gates / revision / outputs / weave.
- `HEDRA_API_KEY`, `ELEVENLABS_API_KEY` — media studio.
- `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` — from `supabase status`.
- Gather connectors (optional): `BRAVE_SEARCH_API_KEY`, `X_BEARER_TOKEN`, `YOUTUBE_API_KEY`, `GATHER_CONTACT_EMAIL`, `NCBI_API_KEY`. RSS, journals (Crossref/arXiv/PubMed), and scrape need no key.

### Gotcha: an empty `ANTHROPIC_API_KEY` in your shell shadows `.env`
Next's dotenv loader does **not** override an env var that is already present in
the process environment. Some agent/CI shells export an empty `ANTHROPIC_API_KEY`,
which then shadows the value in `.env` (you'll see "Missing ANTHROPIC_API_KEY").
Fix for local dev:
```bash
env -u ANTHROPIC_API_KEY npm run dev    # or: unset ANTHROPIC_API_KEY
```
This does not affect production (Vercel) where the var is set correctly.

## Auth phase
`AUTH_DISABLED=true` (default) **skips login**: every request resolves to a single
`DEFAULT_USER_ID` whose workspace + 11 campaigns are auto-provisioned on first
access, and roles are not enforced (assistant has the same access as author).
Set `AUTH_DISABLED=false` to require real Supabase sessions. When real auth +
assistants return, switch the per-piece routes from owner-scoping to
workspace-scoping (currently a no-op since there is one user).

## Useful commands
```bash
npm test                       # vitest (unit + connector + auth-mapping)
npm run db:generate -- --name x   # new migration from schema changes
npx tsx scripts/bootstrap.ts   # optional: provision a dev workspace explicitly
```
