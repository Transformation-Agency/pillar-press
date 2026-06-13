# Gather Integration

Gather is now part of Pillar Press Editorial Desk rather than a drop-in backend
patch. The desktop app uses the same server routes in browser dev and packaged
Tauri builds, with local-first persistence when SQLite is active.

## Server Routes

| Route | Purpose |
|---|---|
| `GET /api/gather/sources` | List configured Gather sources for the active workspace/campaign. |
| `POST /api/gather/sources` | Create a Gather source. |
| `PATCH /api/gather/sources/:id` | Update a Gather source. |
| `DELETE /api/gather/sources/:id` | Remove a Gather source. |
| `POST /api/gather/run` | Run Gather immediately for a campaign. Optional `sourceIds` runs a subset — the UI runs one source per request for real per-source progress. The response includes per-source counts and an `errors` map (connector failure messages keyed by source id). |
| `GET /api/gather/items` | List gathered items. |
| `GET /api/gather/schedules` | List saved schedules (local-first only). |
| `POST /api/gather/schedules` | Create or update (upsert by `id`) a once/daily/weekly schedule (local-first only). |
| `DELETE /api/gather/schedules?id=` | Delete a schedule (local-first only). |
| `POST /api/gather/schedules/run-due` | Run due schedules from the desktop background timer (local-first only). |

## Desktop Behavior

- Schedules are stored in SQLite in `gather_schedules`.
- The packaged Tauri launcher starts a background timer after the local Next
  server is ready.
- The timer calls `/api/gather/schedules/run-due` every minute.
- Browser/dev mode keeps a UI fallback, but it exits early when the Tauri bridge
  is present so desktop builds do not double-run scheduled jobs.
- Schedule saves and deletes are server-first: the UI persists to SQLite before
  caching in localStorage, and surfaces an error instead of keeping a schedule
  the desktop scheduler would never see.
- The schedule routes are local-first only. In hosted/browser mode the server
  rejects them and the UI falls back to tab-local schedules run by the in-page
  timer while the tab stays open.

## Connector Notes

RSS, journal lookup, scraping, and YouTube transcript paths can run without a
cloud model key. Web search needs a Brave Search key and X trending needs an X
bearer token (paid X API tier); YouTube Data API and NCBI keys are optional
extras (video metadata, PubMed rate limits).

Connector keys are managed from the **Integrations** panel on the Gather screen
in the desktop app. They are saved encrypted into the native
`desktop-settings.json` (same mechanism as media provider keys, via the
`save_integration_key` Tauri command) and resolved server-side by
`lib/gather/integrationKeys.ts` — settings-UI keys take precedence, with env
vars (`BRAVE_SEARCH_API_KEY`, `X_BEARER_TOKEN`, `YOUTUBE_API_KEY`,
`NCBI_API_KEY`) as fallbacks for hosted installs and browser dev. `GET
/api/gather/integrations` reports configured status (booleans only, no
secrets). Connector failures are reported per source in the run response and
shown inline on the source row.
Gather summaries use the configured `lib/llm` provider, so local models work
when they can follow the existing summary prompt.
