# BUILD_BRIEF.md — King's Press desktop scope

This is the complete feature scope. For each feature: what it does, **where the logic
already lived** in `prototype-reference/`, and the desktop/local-first work needed to keep
the product shippable. Preserve prompts and rules unless the product owner explicitly asks
to change editorial behavior.

---

## 0. Platform & cross-cutting

- **Stack:** Tauri desktop shell + packaged Next.js App Router server + SQLite local
  database + local app-data file storage. Hosted Postgres/Supabase compatibility can remain,
  but it is not the default desktop runtime.
- **Auth:** local-first desktop mode resolves a single local owner/workspace without a cloud
  auth provider. UI roles still model **author** (full) and **assistant** (can view/edit
  drafts, outputs, and media, but **cannot edit References**) and server routes should
  continue enforcing the assistant restriction where role checks apply.
- **LLM providers:** model calls run server-side through the provider-neutral LLM layer
  (`LLM_PROVIDER=ollama|openai-compatible|openai|anthropic|gemini|xai`). Desktop setup saves
  local Ollama, Docker Model Runner, or optional cloud provider choices into local app-data
  settings. Anthropic compatibility remains for existing env files, but local models are the
  default product posture. **Keep the same prompts and JSON output schemas**.
- **Resilient parsing:** keep `ai.js`'s `extractJSON` + `repairJSON` (truncation recovery)
  server-side; the model output is not always clean JSON.
- **Everything is scoped** to the local workspace and (for pieces/media/references) to a
  **campaign**. Hosted mode must still avoid cross-user/-campaign leakage.

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

- Source of truth: user-created campaign references and `ai.js` `refContext()`
  (the exact serialization passed into prompts — **reuse it**). The former
  prototype campaign list and bulky default references are not seeded in the
  desktop product.
- **Server:** store the references document per campaign (JSONB is fine). A
  `buildRefContext(references)` server util must produce the **same string** `refContext()`
  produces. Reference writes are author-only.

## 4. The Seven Gates (Review Packet)

Run a draft through 7 sequential review passes; each emits a Review Packet section with
findings at three severities (**Must-fix / Consider / Note**), grouped by gate.

- Source of truth: `gates.js` — `GATES` array with each gate's **exact prompt**, the
  per-gate JSON schema (strategy/audience/tone/rigor/stress/clarity/self each have a
  specific shape), `runGate()`, and `SEVERITY`. `ai.js` `refContext` feeds the system prompt.
- **Server:** `POST /api/pieces/:id/review` runs all 7 gates **in order**, each one configured
  LLM call with the gate prompt + ref context, persists results into the piece's `packet`
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

- Media runs through the existing server route handlers and local-first storage/database
  branches: `lib/hedra.ts`, `lib/elevenlabs.ts`, validation, errors, `media_jobs`, routes
  for models, credits, assets upload, **generate** (incl. the ElevenLabs→Hedra audio-sync
  step), user-scoped **status** polling, voices, and media list/delete.
- Studio provider status is capability-driven. `/api/media/providers` reports which
  providers are configured for image, video/avatar, and audio without returning secrets.
  OpenAI, xAI/Grok, and custom OpenAI-compatible image endpoints can join the image
  composer; OpenAI and ElevenLabs can provide voice; Hedra remains the video/avatar provider.
- The front-end Studio should call `fetch('/api/hedra/generate')` and poll
  `'/api/hedra/status/:id'`. The model/voice catalogs in `studio.js` are fallbacks — prefer
  the live `/api/hedra/models` when the optional cloud keys are configured.
- Async: poll `status` every ~3s; stop on completed/failed/canceled; persist output URLs.
  Treat Hedra URLs as possibly temporary — refresh from status, don't assume permanence.

## 10. Settings

Per-user/workspace: local desktop model/provider profiles, per-task LLM defaults,
Google Drive link (folder id + tokens when hosted Drive is used), and non-secret
preferences. Desktop setup may save optional provider API keys in the native app
data settings file; local backups must redact them. Hosted/server deployments
can still use environment variables instead.

---

## Acceptance criteria (whole app)

- `npm run desktop:build` produces a branded King’s Press `.app` and DMG.
- The packaged app launches from the app icon, starts its local server, initializes SQLite,
  starts with no default campaigns, serves the UI, and does not require Supabase/Postgres.
- The desktop browser shell boots from local packaged JS and system fonts; it does not
  require CDN access for React, Babel, or typography.
- First-run setup lets a normal user install/use Ollama, start an existing Ollama install,
  choose an installed/pulled local model, use Docker Model Runner models, or save an
  optional hosted provider API key. The desk UI also lets the user reopen model settings,
  manage multiple provider profiles, and choose per-task defaults.
- Gate review, revision, platform outputs, Gather summaries, and Weave all run through the
  provider-neutral LLM layer with the **same prompts and output shapes** as the prototype.
- Campaigns isolate references + pieces + media; assistant role can't edit references.
- Local storage replaces Supabase Storage in desktop mode; local Drive/export fallback works.
- Gather schedules are durable and run due jobs in the desktop background process.
- Local backups include SQLite data, local files, redacted settings, and a manifest.
- `npm run typecheck`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, and
  `npm run desktop:verify-release` pass.
- Developer ID signing/notarization is supported for public distribution. Before
  release, run a clean-machine installer smoke and the signed release verifier.
