# API_SPEC.md — route contracts

Next.js App Router route handlers run inside the packaged desktop server and in
browser dev. Every route should resolve the current user/workspace through
`requireUser()`, Zod-validate request bodies, scope queries by workspace/campaign,
and return safe errors through `lib/errors.ts`. In desktop mode, `requireUser()`
resolves the embedded local owner instead of a cloud session.

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

## AI passes (server runs the configured LLM provider with the prototype's prompts)
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

## Media — Hedra / ElevenLabs
- `GET    /api/media/providers` — configured optional media providers and
  capabilities; never returns secrets.
- `GET    /api/hedra/models?type=` ✅ — live models + fallback.
- `GET    /api/hedra/credits` ✅.
- `POST   /api/hedra/assets` ✅ — multipart upload (validate type/size) → asset id.
- `POST   /api/hedra/generate` ✅ — validate → (optional ElevenLabs TTS → Hedra audio asset)
  → generate → persist `media_jobs` row.
- `GET    /api/hedra/status/:id` ✅ — user-scoped poll; persist outputs; stop on terminal.
- `GET    /api/eleven/voices` ✅ — voices for the picker.
- `GET    /api/media?pieceId=` ✅ / `DELETE /api/media?id=` ✅ — the user's library.
- `PATCH  /api/media/:id` — attach/detach to a piece (`source_content_id`).  ← add this.

## Export — local fallback + Google Drive
- `GET    /api/drive/status` — is Drive linked? folder name.
- `GET    /api/drive/auth` → OAuth consent; callback stores refresh token + folder.
- `POST   /api/drive/upload` — `{ pieceId, scope:'one'|'all', platform? }` → upload
  markdown (built with `exporters.js#outputMarkdown`) to the linked folder; return file links.
- Download (`.md` / `.zip`) stays client-side via `exporters.js`.

## Settings
- `GET/PUT /api/settings` — Drive folder + non-secret prefs.
- Native desktop model/provider setup is saved outside this route in the app-data
  `desktop-settings.json` file through Tauri commands. Backups redact secret-like
  fields from that file.

## Auth/role enforcement (test these)
- Hosted unauthenticated requests → 401 on protected routes.
- Desktop local-first requests → embedded local owner/workspace.
- `assistant` role → 403 on `PUT /api/campaigns/:id/references`.
- Fetching another user's piece/media → 404 (not 403, don't reveal existence).
