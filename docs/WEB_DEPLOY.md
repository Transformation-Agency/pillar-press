# Hosted Web Deployment

King's Press can run as an internet-accessible Next.js web app without reverting
to the old Pillar Press code. The hosted runtime uses:

- Next.js App Router API routes.
- Hosted Postgres through `DATABASE_URL`.
- Supabase Storage for public media assets.
- Supabase Auth for hosted accounts when `AUTH_DISABLED=false`.
- The current King’s Press static workspace UI.
- Optional Basic Auth only for temporary private previews while `AUTH_DISABLED=true`.

## Required Environment

Start from `.env.hosted.example` and set these values in your host:

```bash
KINGS_PRESS_RUNTIME=hosted
KINGS_PRESS_HOSTED_WEB=true
KINGS_PRESS_LOCAL_FIRST=false
DATA_BACKEND=postgres
STORAGE_PROVIDER=supabase
KINGS_PRESS_STORAGE=supabase

DATABASE_URL=postgres://...
SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

AUTH_DISABLED=false
```

With `AUTH_DISABLED=false`, the static browser app shows a King's Press
sign-in/create-account screen, signs users in through Supabase Auth, attaches
the Supabase bearer token to same-origin `/api/*` calls, and auto-creates the
first workspace on the first authenticated request.

For a temporary private preview without user accounts, set `AUTH_DISABLED=true`
and add:

```bash
SITE_USERS=king,pillar
SITE_PASSWORD=<strong-password>
```

Set `SITE_USERS` to your own comma-separated usernames if you do not want the
default `king,pillar` aliases. The password is the secret; usernames are only an
allow-list. If the browser keeps sending old credentials, open a private window
or fully close the browser tab.

## Vercel

Use the normal Next.js project settings:

```bash
Build command: npm run web:build
Install command: npm install
```

Set every required env var in Vercel. Run database migrations against the hosted
Postgres database before using the app:

```bash
npm run db:migrate
psql "$DATABASE_URL" -f db/migrations/0005_gather_summary.sql
```

## Hetzner Or Any VPS

Install Node 22+ and run:

```bash
git clone https://github.com/jedisherpa/pillar-press.git
cd pillar-press
npm install
cp .env.hosted.example .env
npm run db:migrate
psql "$DATABASE_URL" -f db/migrations/0005_gather_summary.sql
npm run web:build
PORT=3000 npm run web:start
```

Put Nginx or Caddy in front of port `3000` and terminate TLS there.

`npm run web:start` runs the prepared `.next/standalone/server.js` bundle with
hosted-mode environment overrides, binding to `0.0.0.0` by default.
