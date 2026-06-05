# CLAUDE.md — working instructions for this backend

You are building the backend for **Pillar Press**. A complete front-end prototype exists
in `prototype-reference/`. Build the server it needs. Read `BUILD_BRIEF.md`,
`DATA_MODEL.md`, and `API_SPEC.md` before writing code.

## Ground rules

- **Port business logic verbatim.** The gate prompts, the platform generation order, the
  weave map-reduce, and the revision rules already exist in `prototype-reference/*.js`.
  Do **not** redesign them — translate them to server code, keeping prompts, ordering,
  and validation identical. Where the prototype's behavior and this doc disagree, the
  prototype is the source of truth for *what the feature does*; this doc is the source of
  truth for *how the server should be structured*.
- **Secrets are server-only.** `ANTHROPIC_API_KEY`, `HEDRA_API_KEY`, `ELEVENLABS_API_KEY`,
  and Google OAuth secrets live in server runtime. Never expose them to the client, logs,
  responses, or `NEXT_PUBLIC_*`. The browser only calls your own `/api/*` routes.
- **Stack:** Next.js App Router on Vercel, Postgres + Drizzle, Zod for every request body.
  Match the patterns already in `server/`.
- **Auth + authorization on every route.** Use the `requireUser()` seam in
  `server/lib/auth.ts` (wire it to your real auth provider). Every read/write is scoped by
  `userId`/`workspaceId`; one user must never touch another's data.
- **Keep AI calls resilient.** The model has a limited output budget, so the prototype
  chunks long work. Preserve that: the revision and weave run in bounded passes; tolerate
  malformed/truncated JSON (see `ai.js` `repairJSON`). Use streaming or background jobs for
  long multi-call operations where it improves UX, but the persisted row is the source of
  truth.
- **Don't break the front-end contract.** The response shapes you return should map cleanly
  onto the prototype's data structures (see `DATA_MODEL.md`). When in doubt, match the
  object shapes the prototype already stores in `localStorage` (read `store.js`).
- **Migrations over rewrites.** Add tables; don't restructure broadly. `server/db/` already
  has the `media_jobs` table — follow that style for the rest.

## Build order (suggested)

1. Auth seam + db client + base Zod/error utilities (mostly present in `server/lib/`).
2. Data model + migrations for campaigns, pieces, references, settings, media (DATA_MODEL.md).
3. CRUD APIs for campaigns / pieces / references / settings.
4. Anthropic wrapper (server-side `complete()`), then the AI features in this order:
   gates → revision → platform generators → weave. Port prompts from the reference files.
5. Media: finish the Hedra/ElevenLabs routes in `server/` (already scaffolded) + polling.
6. Google Drive export (server-side OAuth).
7. Tests for each integration client and the generation routes (extend `server/__tests__`).

## Definition of done

- App builds and deploys on Vercel.
- No secret is reachable client-side (grep the client bundle for the keys).
- Every prototype feature has a real API: gate review, proposed revision, platform outputs,
  weave, campaigns/references, media generation, Drive export.
- Authorization is enforced and tested; one user cannot read another's pieces or media.
- The front-end works against the new API with `localStorage` + `window.claude.complete`
  removed.
