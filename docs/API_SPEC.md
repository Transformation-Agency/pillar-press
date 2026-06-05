# API_SPEC.md — endpoints to implement

Next.js App Router route handlers. Every route: `requireUser()` first, Zod-validate the
body, scope queries by user/campaign, return safe errors (see `server/lib/errors.ts`).
Routes that already exist in `server/` are marked ✅.

## Campaigns
- `GET    /api/campaigns` — list workspace campaigns.
- `POST   /api/campaigns` — `{ name }` → create (seed references from template).
- `PATCH  /api/campaigns/:id` — rename.
- `GET    /api/campaigns/:id/references` — current references doc.
- `PUT    /api/campaigns/:id/references` — replace/patch references. **author role only.**

## Pieces
- `GET    /api/campaigns/:cid/pieces` — list (Library).
- `POST   /api/campaigns/:cid/pieces` — `{ title, original? }` → create (status Draft).
- `GET    /api/pieces/:id` — full piece.
- `PATCH  /api/pieces/:id` — update title/original/status.
- `DELETE /api/pieces/:id`.

## AI passes (server runs Anthropic with the prototype's prompts)
- `POST   /api/pieces/:id/review` — run the **7 gates in order**; persist `packet`
  incrementally; set Draft→Reviewed. Consider SSE/streaming or a job + `GET .../review/status`
  so the UI can show the gate-by-gate rail. Logic: `gates.js`.
- `POST   /api/pieces/:id/revision` — chunked **proposed revision** + changelog; persist;
  set Reviewed→Revised. Logic: `generators.js#generateRevision`.
- `POST   /api/pieces/:id/outputs` — `{ active:string[], audiences:{[platform]:audienceId} }`;
  generate platforms in fixed order; persist `outputs`+`outputOrder`. Logic:
  `generators.js#generateOutputs` (two calls/platform: body + metadata).

## Weave
- `POST   /api/weave` — `{ sources:[{name,text}] }` → `{ extracts, brief, mapping, draft }`.
  Long runs: return a job id + `GET /api/weave/:id` for progress. Logic: `weave.js`.
- "Send to Library" = `POST /api/campaigns/:cid/pieces` with the draft.

## Media — Hedra / ElevenLabs  (scaffolded in server/)
- `GET    /api/hedra/models?type=` ✅ — live models + fallback.
- `GET    /api/hedra/credits` ✅.
- `POST   /api/hedra/assets` ✅ — multipart upload (validate type/size) → asset id.
- `POST   /api/hedra/generate` ✅ — validate → (optional ElevenLabs TTS → Hedra audio asset)
  → generate → persist `media_jobs` row.
- `GET    /api/hedra/status/:id` ✅ — user-scoped poll; persist outputs; stop on terminal.
- `GET    /api/eleven/voices` ✅ — voices for the picker.
- `GET    /api/media?pieceId=` ✅ / `DELETE /api/media?id=` ✅ — the user's library.
- `PATCH  /api/media/:id` — attach/detach to a piece (`source_content_id`).  ← add this.

## Export — Google Drive (move server-side)
- `GET    /api/drive/status` — is Drive linked? folder name.
- `GET    /api/drive/auth` → OAuth consent; callback stores refresh token + folder.
- `POST   /api/drive/upload` — `{ pieceId, scope:'one'|'all', platform? }` → upload
  markdown (built with `exporters.js#outputMarkdown`) to the linked folder; return file links.
- Download (`.md` / `.zip`) stays client-side via `exporters.js`.

## Settings
- `GET/PUT /api/settings` — Drive folder + non-secret prefs. **No provider keys here.**

## Auth/role enforcement (test these)
- Unauthenticated → 401 on every route.
- `assistant` role → 403 on `PUT /api/campaigns/:id/references`.
- Fetching another user's piece/media → 404 (not 403, don't reveal existence).
