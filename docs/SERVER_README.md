# Media Integration

King's Press Editorial Desk keeps media routes server-side even in the desktop
app. The browser calls allowlisted `/api/*` routes; provider keys stay in the
packaged local server environment, desktop settings, or hosted deployment
environment.

## Included Server Modules

| Area | Files |
|---|---|
| Hedra client | `lib/hedra.ts` |
| ElevenLabs client | `lib/elevenlabs.ts` |
| Validation | `lib/validation.ts` |
| Safe errors | `lib/errors.ts` |
| Auth/local owner resolution | `lib/auth.ts` |
| Database switch | `lib/db.ts`, `lib/local/database.ts` |
| Storage switch | `lib/storage.ts`, `lib/local/storage.ts` |
| Media routes | `app/api/hedra/**`, `app/api/eleven/voices`, `app/api/media/**` |

## Desktop Behavior

- Generated media jobs are persisted in the local SQLite database when the
  desktop/local-first backend is active.
- Uploaded or generated files are stored in the app-data storage directory and
  served through `/api/local-files/...`.
- Hedra and ElevenLabs remain optional cloud integrations. The rest of the
  editorial desk should still run without those keys.
- If cloud media keys are present, the local Next server owns all provider calls;
  browser code never receives raw keys.

## Security Model

- `HEDRA_API_KEY`, `ELEVENLABS_API_KEY`, and model provider keys are never placed
  in `NEXT_PUBLIC_*`, browser globals, route responses, or local backups.
- The browser cannot call arbitrary provider paths; it calls fixed King’s Press
  API routes that map to allowlisted provider client functions.
- Every request body is validated with Zod. Uploads are checked for type/size.
  Prompts and filenames are sanitized before storage/display.
- Provider error bodies are logged server-side only and mapped to safe client
  errors.
- Hedra output URLs can be temporary/signed; refresh via status polling rather
  than assuming stored URLs are permanent.

## Narrated Video Flow

1. `POST /api/hedra/assets` with an image or generated start frame.
2. `POST /api/hedra/generate` with `type: "avatar_video"`, the `startAssetId`, a
   script, and a voice id.
3. The route renders voiceover through ElevenLabs, uploads it to Hedra as an
   audio asset, and starts the video generation.
4. The client polls `GET /api/hedra/status/[id]` until the job reaches a terminal
   state.
5. The job remains attached to the campaign/piece in the local media library.

## Hosted Compatibility

Hosted deployments can still use environment variables and the Postgres/Drizzle
path. Desktop distribution does not require Vercel, Supabase, or Postgres.
