# Gather Integration

Gather is now part of King's Press Editorial Desk rather than a drop-in backend
patch. The desktop app uses the same server routes in browser dev and packaged
Tauri builds, with local-first persistence when SQLite is active.

## Server Routes

| Route | Purpose |
|---|---|
| `GET /api/gather/sources` | List configured Gather sources for the active workspace/campaign. |
| `POST /api/gather/sources` | Create a Gather source. |
| `PATCH /api/gather/sources/:id` | Update a Gather source. |
| `DELETE /api/gather/sources/:id` | Remove a Gather source. |
| `POST /api/gather/run` | Run Gather immediately for a campaign. |
| `GET /api/gather/items` | List gathered items. |
| `GET /api/gather/schedules` | List saved schedules. |
| `POST /api/gather/schedules` | Create a once/daily/weekly schedule. |
| `PATCH /api/gather/schedules/:id` | Update a schedule. |
| `DELETE /api/gather/schedules/:id` | Delete a schedule. |
| `POST /api/gather/schedules/run-due` | Run due schedules from the desktop background timer. |

## Desktop Behavior

- Schedules are stored in SQLite in `gather_schedules`.
- The packaged Tauri launcher starts a background timer after the local Next
  server is ready.
- The timer calls `/api/gather/schedules/run-due` every minute.
- Browser/dev mode keeps a UI fallback, but it exits early when the Tauri bridge
  is present so desktop builds do not double-run scheduled jobs.

## Connector Notes

RSS, journal lookup, scraping, and YouTube transcript paths can run without a
cloud model key. Web search needs `BRAVE_SEARCH_API_KEY` or `Brave_Kings_Press`;
`Brave_Pillar_Press` remains a legacy environment fallback for existing hosted
installs.
Gather summaries use the configured `lib/llm` provider, so local models work
when they can follow the existing summary prompt.
