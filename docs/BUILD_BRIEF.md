# BUILD_BRIEF.md — Pillar Press backend scope

This is the complete feature scope. For each feature: what it does, **where the logic
already lives** in `prototype-reference/`, and the **server work** to do. Port prompts and
rules verbatim; build the persistence and auth around them.

---

## 0. Platform & cross-cutting

- **Stack:** Next.js App Router (Vercel), Postgres + Drizzle, Zod. Mirror `server/`.
- **Auth:** real provider behind `server/lib/auth.ts`. Two roles: **author** (full) and
  **assistant** (can view/edit drafts, outputs, and media, but **cannot edit References**).
  Enforce the assistant restriction server-side on reference write routes.
- **Anthropic:** the prototype calls a browser helper `window.claude.complete(...)`
  (model `claude-haiku-4-5`, 1024-token output cap). Replace with a **server-side Anthropic
  client** using `ANTHROPIC_API_KEY`. You may use a larger `max_tokens` server-side, but
  **keep the same prompts and JSON output schemas** (see `ai.js`, `gates.js`,
  `generators.js`, `weave.js`). The chunking exists because of the small cap — if you raise
  the cap you may simplify it, but behavior/outputs must match.
- **Resilient parsing:** keep `ai.js`'s `extractJSON` + `repairJSON` (truncation recovery)
  server-side; the model output is not always clean JSON.
- **Everything is scoped** to user/workspace and (for pieces/media/references) to a
  **campaign**. No cross-user/-campaign leakage.

---

## 1. Campaigns

Switchable brand/persona profiles. The prototype seeds **11**: Me, Anna, Diana, Liana, Max,
Transformation Agency, Metacanon AI, Lumenus Inc, Jedi Sherpa, Wizard Joe, Feral Pharaoh.
Each campaign owns its **own References** and its **own pieces + media**. Switching campaign
changes which guidelines every AI feature reads.

- Source of truth: `store.js` (`campaigns`, `activeCampaignId`, `makeCampaigns`,
  `setActiveCampaign`, `addCampaign`, per-campaign `references`).
- **Server:** `campaigns` table; CRUD; seed the 11 on workspace creation. A campaign has a
  `references` document (see §3). `activeCampaignId` is a per-user UI preference (store on
  the user or client; not authoritative for data scoping — scope by explicit `campaignId`).

## 2. Pieces & status pipeline

A piece is one long-form work moving through **Draft → Reviewed → Revised → Approved →
Formatted** (status is **set manually** by the user, never auto-advanced beyond the
prototype's small conveniences). A piece holds: `original` (draft text), `packet` (gate
results), `revision` ({text, changelog}), `outputs` (per-platform), `outputOrder`.

- Source of truth: `store.js` (`pieces`, `createPiece`, `updatePiece`, `STATUSES`).
- **Server:** `pieces` table (+ child tables or JSONB for packet/revision/outputs — see
  DATA_MODEL.md). CRUD scoped by campaign + user. Library lists a campaign's pieces.

## 3. References (per campaign, live)

The editorial source of truth every AI pass reads: **strategy + throughlines**, **audiences**,
**two voice registers**, **clarity rules**, **red lines**, **self-vision**, **gate spec**.
Editable in place; the gates/generators/weave must always read the **current** version.

- Source of truth: `store.js` `SEED_REFERENCES` (full default content) and
  `ai.js` `refContext()` (the exact serialization passed into prompts — **reuse it**).
- **Server:** store the references document per campaign (JSONB is fine). A
  `buildRefContext(references)` server util must produce the **same string** `refContext()`
  produces. Reference writes are author-only.

## 4. The Seven Gates (Review Packet)

Run a draft through 7 sequential review passes; each emits a Review Packet section with
findings at three severities (**Must-fix / Consider / Note**), grouped by gate.

- Source of truth: `gates.js` — `GATES` array with each gate's **exact prompt**, the
  per-gate JSON schema (strategy/audience/tone/rigor/stress/clarity/self each have a
  specific shape), `runGate()`, and `SEVERITY`. `ai.js` `refContext` feeds the system prompt.
- **Server:** `POST /api/pieces/:id/review` runs all 7 gates **in order**, each one Anthropic
  call with the gate prompt + ref context, persists results into the piece's `packet`
  incrementally (so a UI can stream/poll progress), then sets status `Draft → Reviewed`.
  Use one call per gate (keeps each output bounded). Return the packet. Findings carry an
  `anchor` (verbatim quote) used by the UI to jump to the passage — preserve it.

## 5. Proposed Revision

A full rewrite that applies **only** clarity, tone, and inoculation findings (strategy,
audience, rigor, identity stay in the report), preserves structure/register, obeys "where a
clarity rule would flatten a line that sounds like the author, the author's line wins," and
ends with a **changelog** tracing each change to its finding id.

- Source of truth: `generators.js` — `generateRevision()`. It **chunks** the draft into
  passages and uses a **delimiter format** (`@@REVISION@@ / @@CHANGELOG@@ / @@END@@`), not
  JSON, so long text never breaks parsing. `chunkText`, `parseDelimited` are there.
- **Server:** `POST /api/pieces/:id/revision`. Port the chunked passes exactly. Persist
  `revision = { text, changelog }`; set `Reviewed → Revised`. Stream/queue if long.

## 6. Platform Generators (Outputs)

Generate platform-native posts. Toggles: Substack, Facebook, Instagram, X, Threads (each
on/off). Audience preset per platform per run. **Fixed derivation order** (provenance):
Substack first (canonical) → Facebook (from Substack) → Instagram (from Facebook) → X (from
Substack+Facebook) → Threads (from Facebook+X); if Substack off, Facebook is the source.
Each output has: platform, selected audience, throughline tag, strategic purpose, draft post,
2–3 hooks, 2–3 CTAs, media rec, risk/red-line check, related offering, follow-up.

- Source of truth: `generators.js` — `PLATFORMS`, `resolveSources`, `generateOutputs`,
  `generatePlatform`. **Two calls per platform**: a delimiter **body** call + a compact
  **metadata JSON** call (so a long post never starves the structured fields). Keep this.
- **Server:** `POST /api/pieces/:id/outputs` with `{ active: string[], audiences: map }`.
  Run platforms in the fixed order, threading prior outputs. Persist `outputs` + `outputOrder`.

## 7. Weave (multi-file synthesis)

Fuse many uploaded files on different topics into one emergent concept + a single coherent
draft, then create a piece from it. Map-reduce so file count/length never truncates:
**extract each file → synthesize brief → map to the campaign's throughlines → draft section
by section.**

- Source of truth: `weave.js` — `extractSource`, `synthesizeBrief`, `mapToThroughlines`,
  `draftSection`, `runWeave` (with all prompts). Output = `{ extracts, brief, mapping, draft }`.
- **Server:** `POST /api/weave` (accept many text sources). Run the pipeline; return the
  brief + draft. "Send to Library" = create a piece (status Draft) with `original = draft`
  in the active campaign. Long runs → background job + progress.

## 8. Outputs export (download + Google Drive)

- **Download:** per-output `.md` and a `.zip` of all outputs. Logic in `exporters.js`
  (`outputMarkdown`, `zipBlob`). This can stay client-side; no server needed.
- **Google Drive:** save outputs to a linked Drive folder. The prototype uses browser
  Google Identity Services (`drive.js`) with a user-entered Client ID — **move this
  server-side**: OAuth (offline/refresh token) with `GOOGLE_CLIENT_ID/SECRET`, store the
  user's refresh token + target folder id, and upload via the Drive API from the server.
  `POST /api/drive/upload` (one or many files). Keep the download fallback.

## 9. Media Studio — Hedra + ElevenLabs

Generate **images**, **image→video animation**, **avatar/talking-head video**, and **voice
(TTS)**, and produce **video synced to ElevenLabs audio** (avatar lip-sync or animation with
the audio as soundtrack). Media is campaign-scoped and attachable to a piece.

- **The production backend for this is already written** in `server/` (the reference
  implementation): `server/lib/hedra.ts`, `server/lib/elevenlabs.ts`, validation, errors,
  the `media_jobs` schema/migration, and routes for models, credits, assets upload,
  **generate** (incl. the ElevenLabs→Hedra audio-sync step), user-scoped **status** polling,
  voices, and media list/delete. Finish wiring `auth.ts`/`db.ts`, deploy, and connect the UI.
- The **front-end** Studio is built (`screen-studio.jsx`, `studio.js`, `media-components.jsx`);
  its generation is **simulated**. Swap the simulated `runJob`/`speak` for
  `fetch('/api/hedra/generate')` + poll `'/api/hedra/status/:id'`. The model/voice catalogs
  in `studio.js` are fallbacks — prefer the live `/api/hedra/models` (don't hardcode a model).
- Async: poll `status` every ~3s; stop on completed/failed/canceled; persist output URLs.
  Treat Hedra URLs as possibly temporary — refresh from status, don't assume permanence.

## 10. Settings

Per-user/workspace: Google Drive link (folder id + tokens), and — only relevant in the
prototype — Hedra/Eleven keys. **In production the provider keys are server env vars, not
user settings.** Keep a `settings` concept for Drive folder + non-secret prefs.

---

## Acceptance criteria (whole app)

- Builds + deploys on Vercel; no secret reachable client-side.
- Gate review, revision, platform outputs, and weave all run server-side with the **same
  prompts and output shapes** as the prototype, persisted per piece.
- Campaigns isolate references + pieces + media; assistant role can't edit references.
- Media generation (image, animation, avatar voiced video) works through `/api/hedra/*`
  with the ElevenLabs audio-sync path; jobs persist and poll to completion.
- Drive export works server-side; download fallback intact.
- Authorization enforced + tested; no cross-user/-campaign reads.
