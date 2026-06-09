# DATA_MODEL.md — entities & tables

The desktop product stores its primary data in SQLite through
`db/local-sqlite-schema.sql`. The Drizzle/Postgres schema remains for hosted
compatibility, but it is not required for normal King’s Press Editorial Desk
installs.

Object shapes should map onto the original prototype store names because the UI
and editorial workflows still depend on those contracts.

All durable entities carry `created_at` / `updated_at` where practical. Desktop
mode scopes everything to the embedded local workspace; hosted compatibility
continues to scope by `user_id` and/or `workspace_id`. IDs are text identifiers
in SQLite and uuid/text equivalents in hosted mode.

## users / workspaces / membership
Desktop mode auto-provisions one local owner and workspace. Membership carries a
`role`: `author` | `assistant`. Assistant cannot write references. Hosted mode
can map these concepts to an external auth provider.

## campaigns
| column | type | notes |
|---|---|---|
| id | text/uuid | pk |
| workspace_id | text | scope |
| slug | text | e.g. `feral-pharaoh` (unique per workspace) |
| name | text | display |
Seed the 11 names on workspace creation. Each campaign has one **references** row.

## references  (one per campaign)
| column | type | notes |
|---|---|---|
| id | text/uuid | pk |
| campaign_id | text/uuid | fk -> campaigns (unique) |
| doc | json/jsonb | the full references document |
`doc` shape: `{ strategy{throughlines[],body}, audiences{list[]},
registers{list[],body}, voiceRules{rules[]}, redLines{rules[]}, selfVision{body}, gateSpec{body} }`.
New campaigns start with a blank skeleton for this shape instead of a bulky
default references document.
A server util must serialize this into prompt context **identically** to `ai.js` `refContext()`.

## pieces
| column | type | notes |
|---|---|---|
| id | text/uuid | pk |
| campaign_id | text/uuid | fk |
| user_id | text | owner |
| title | text | |
| status | text | `Draft\|Reviewed\|Revised\|Approved\|Formatted` (manual) |
| original | text | the draft |
| packet | json/jsonb | gate results, keyed by gate id (nullable) |
| revision | json/jsonb | `{ text, changelog: [{change,finding,note}] }` (nullable) |
| outputs | json/jsonb | `{ [platformId]: OutputObject }` (nullable) |
| output_order | json/jsonb | `string[]` platform ids in generation order |

`packet[gateId]` shapes are gate-specific — see `gates.js` (strategy/audience/tone/rigor/
stress/clarity/self). Each finding: `{ severity:'must'|'consider'|'note', title, detail, anchor }`.
You may normalize packet/outputs into child tables instead of JSON; JSON remains
the lowest-friction path and matches the prototype.

## media_jobs
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
| prefs | json/jsonb | non-secret UI prefs (theme, active campaign, tweaks) |

Desktop LLM setup is stored outside this table in the native app-data
`desktop-settings.json`, pointed to the server by `KINGS_PRESS_LLM_SETTINGS_PATH`.
That file can contain an optional provider API key for cloud models. Local backup
creation must null secret-like fields before copying settings into a backup.
Hosted/server deployments can still use provider keys from environment variables.

## Relationships
workspace 1—* campaigns 1—1 references; campaign 1—* pieces; piece 1—* media_jobs
(via `source_content_id`); campaign 1—* media_jobs.
