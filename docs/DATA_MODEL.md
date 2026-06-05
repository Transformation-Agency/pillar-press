# DATA_MODEL.md — entities & tables

Postgres + Drizzle. Mirror the style of `server/db/schema.ts` (already written for
`media_jobs`). Object shapes should map onto what the prototype stores in `localStorage`
(read `prototype-reference/store.js` for the canonical field names).

All tables carry `created_at` / `updated_at`. Scope everything by `user_id` and/or
`workspace_id`. `id` = uuid pk.

## users / workspaces / membership
Use your auth provider's users. A **workspace** groups a team. **Membership** carries a
`role`: `author` | `assistant`. (Assistant cannot write references.)

## campaigns
| column | type | notes |
|---|---|---|
| id | uuid | pk |
| workspace_id | text | scope |
| slug | text | e.g. `feral-pharaoh` (unique per workspace) |
| name | text | display |
Seed the 11 names on workspace creation. Each campaign has one **references** row.

## references  (one per campaign)
| column | type | notes |
|---|---|---|
| id | uuid | pk |
| campaign_id | uuid | fk → campaigns (unique) |
| doc | jsonb | the full references document |
`doc` shape = `SEED_REFERENCES` in `store.js`: `{ strategy{throughlines[],body}, audiences{list[]},
registers{list[],body}, voiceRules{rules[]}, redLines{rules[]}, selfVision{body}, gateSpec{body} }`.
A server util must serialize this into prompt context **identically** to `ai.js` `refContext()`.

## pieces
| column | type | notes |
|---|---|---|
| id | uuid | pk |
| campaign_id | uuid | fk |
| user_id | text | owner |
| title | text | |
| status | text | `Draft\|Reviewed\|Revised\|Approved\|Formatted` (manual) |
| original | text | the draft |
| packet | jsonb | gate results, keyed by gate id (nullable) |
| revision | jsonb | `{ text, changelog: [{change,finding,note}] }` (nullable) |
| outputs | jsonb | `{ [platformId]: OutputObject }` (nullable) |
| output_order | jsonb | `string[]` platform ids in generation order |

`packet[gateId]` shapes are gate-specific — see `gates.js` (strategy/audience/tone/rigor/
stress/clarity/self). Each finding: `{ severity:'must'|'consider'|'note', title, detail, anchor }`.
You may normalize packet/outputs into child tables instead of JSONB; JSONB is the low-effort
path and matches the prototype.

## media_jobs  (ALREADY DEFINED in server/db/schema.ts)
Hedra/Eleven generation jobs. Fields: ownership (`user_id`, `workspace_id`, `campaign_id`,
`source_content_id` = piece id), provider refs (`hedra_generation_id`, `hedra_asset_id`,
`eleven_audio_asset_id`), request (`type`, `prompt`, `model_id`, `model_name`, `voice_id`,
`aspect_ratio`, `resolution`, `duration`), lifecycle (`status`, `progress`), outputs
(`output_url`, `download_url`, `thumbnail_url`), accounting (`credits_estimate/actual`,
`error_message`, `meta`), timestamps (`completed_at`). Use as-is.

## settings  (per user or per workspace)
| column | type | notes |
|---|---|---|
| drive_folder_id | text | destination Drive folder |
| drive_refresh_token | text (encrypted) | server-side OAuth |
| prefs | jsonb | non-secret UI prefs (theme, active campaign, tweaks) |
**Provider API keys are NOT stored here** — they are server env vars.

## Relationships
workspace 1—* campaigns 1—1 references; campaign 1—* pieces; piece 1—* media_jobs
(via `source_content_id`); campaign 1—* media_jobs.
