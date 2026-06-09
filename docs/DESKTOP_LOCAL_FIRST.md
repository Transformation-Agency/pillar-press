# King’s Press Editorial Desk — local-first desktop architecture

This repo contains the local-first Tauri desktop build of **King’s Press
Editorial Desk**.

## Desktop runtime
- App name: **King’s Press Editorial Desk**.
- Tauri package: `src-tauri/`.
- Desktop scripts:
  - `npm run desktop:dev`
  - `npm run desktop:build`
  - `npm run desktop:prepare-sidecar`
- `npm run desktop:dev` starts the local web runtime through `npm run desktop:web`,
  which sets:
  - `KINGS_PRESS_LOCAL_FIRST=true`
  - `STORAGE_PROVIDER=local`
- `npm run desktop:build` runs a Next standalone build and copies the packaged
  server runtime into `src-tauri/resources/desktop-server`. The production Tauri
  launcher starts that local server on a private `127.0.0.1` port, initializes
  SQLite in the app data directory, and navigates the webview to the local server.
- On macOS, the launcher disables window restoration and clears stale saved app
  state before Tauri starts. This prevents the OS from blocking app-icon launches
  behind a hidden restore prompt after a forced quit or crash.
- `npm run desktop:prepare-sidecar` also copies the Node runtime used for the
  build into `src-tauri/resources/node`. The production Tauri launcher prefers
  this bundled runtime, with `KINGS_PRESS_NODE_BIN` retained as a developer
  override. This removes the normal-user requirement to install Node separately.
- The sidecar preparation step prunes hosted-only Google Drive SDK packages from
  the desktop resource bundle. Local exports remain available; hosted/web builds
  still use Google Drive support from normal `node_modules` when configured.
- The browser shell is self-contained at startup. React, ReactDOM, and Babel are
  vendored under `public/vendor/`, and typography uses system serif/mono stacks
  instead of remote font downloads.
- First-run setup lets a user choose Ollama, Docker Model Runner, or a hosted
  provider API key. Ollama setup checks whether Ollama is installed/running, can
  open the Ollama installer page, starts an existing Ollama install, lists
  installed models, pulls a selected model, and stores the selected model only
  after it is available. Docker Model Runner setup lists OpenAI-compatible
  models from `http://localhost:12434/engines/v1` by default. Hosted setup saves
  the selected provider, model, optional base URL, and API key to local desktop
  settings. The launcher resolves Ollama through `OLLAMA_BIN`, common Homebrew
  install paths, and then `PATH`.
- The saved model choice is passed to the Next runtime through
  `KINGS_PRESS_LLM_SETTINGS_PATH`; local-first mode defaults to
  `LLM_PROVIDER=ollama` when no explicit cloud provider is configured.
- The native settings file can store multiple LLM provider profiles plus
  per-task defaults. Normal users configure this from first-run setup / **Set Up
  Local Model...**: for example Gather and Weave can use an Ollama or Docker
  Model Runner profile, drafting can use OpenAI/ChatGPT, review can use
  xAI/Grok, and revision can use Anthropic. The public status endpoint reports
  profile ids, models, providers, capabilities, and task mappings, but never
  provider keys.
- First-run setup completion is inferred from the native desktop settings file,
  not only from browser localStorage. If WebView storage is cleared or app data
  is restored from backup, an existing saved provider/model choice prevents the
  setup modal from reappearing unnecessarily. The **Set Up Local Model...** menu
  item still opens setup on demand.
- The completion check is provider-aware. Ollama setup is complete only when the
  saved model is installed and Ollama is running; Docker Model Runner setup is
  complete only when the saved model is listed by the configured endpoint; cloud
  setup is complete only when the saved key/base URL requirements are present.
  Because backups redact keys, restored cloud setups reopen the modal for key
  re-entry.
- Optional cloud providers are still supported through the same server-side LLM
  interface: Anthropic, OpenAI/ChatGPT API, xAI/Grok, Gemini, and generic
  OpenAI-compatible endpoints. These are opt-in overrides, not desktop defaults.
- Studio media providers are also optional and server-side. Hedra covers
  image/video/avatar generation, ElevenLabs covers voice, OpenAI can provide
  image and voice generation, xAI/Grok can provide image generation through an
  OpenAI-compatible image endpoint, and a custom image endpoint can be configured
  with `MEDIA_IMAGE_*` variables. The UI
  reports provider capabilities without storing media API keys in browser state.
- The native desktop menu exposes normal-user setup actions:
  - **Set Up Local Model...** reopens first-run model setup.
  - **Start Ollama** starts the local Ollama service when it is installed but
    not already running.
  - **Open Data Folder** reveals the SQLite database, settings file, and local
    storage directory.
  - **Create Local Backup** writes a timestamped copy of the SQLite database,
    redacted desktop settings, and local storage folder under the app-data
    `backups` directory, then opens that backup in the OS file manager.
  - **Open Backups Folder** opens the local backup directory.
  - **Install Ollama...** opens the Ollama download page.
- The desktop topbar also exposes quick actions for **Create local backup** and
  **Model settings**, so non-technical users can manage backups and provider
  defaults without using the OS menu bar.

## Local database
- Target database: SQLite in the Tauri app data directory.
- Initial schema: `db/local-sqlite-schema.sql`.
- The schema includes local replacements for campaigns, references, pieces, learned style profiles/feedback, media jobs, settings, Gather sources/items, and `gather_schedules`.
- Server-side local database runtime: `lib/local/database.ts`.
- The runtime creates the local owner, workspace, and membership, but does not
  preload campaigns. A clean install starts empty; users create only the
  campaigns they need, and each new campaign receives a small blank references
  skeleton.
- Override paths for development or backup testing:
  - `KINGS_PRESS_DATA_DIR=/path/to/app-data`
  - `KINGS_PRESS_DB_PATH=/path/to/kings-press.sqlite3`
- Backups are local folders named `kings-press-backup-<unix-ms>`. The SQLite
  copy is created with SQLite `VACUUM INTO` so the backup is consistent while
  the app is running. Desktop settings are included with API keys, tokens,
  secrets, and passwords nulled out; cloud provider keys should be re-entered
  after restoring a backup. Each backup includes `backup-manifest.json` with the
  app version, creation timestamp, included files, and settings redaction policy.

## Supabase replacement
Supabase is replaced in local-first desktop mode by embedded local services:
- Auth: no cloud auth by default; one local desktop owner profile. When
  `KINGS_PRESS_LOCAL_FIRST=true`, `DATA_BACKEND=sqlite`, or `KINGS_PRESS_DB_PATH`
  is set, `lib/auth.ts` resolves requests from the embedded local profile without
  touching Supabase or Postgres.
- Database: SQLite instead of Supabase Postgres.
- Storage: local app-data file storage instead of Supabase Storage. `lib/storage.ts`
  now writes generated media through `lib/local/storage.ts` when
  `STORAGE_PROVIDER=local` or Supabase is not configured, and files are served by
  `/api/local-files/...`.
- Drive/export: in local-first mode `/api/drive/status` advertises local export
  availability, `/api/drive/upload` and `/api/drive/upload-media` save files into
  local app-data storage, and Google OAuth routes return a clear local-first
  message instead of starting a cloud-link flow. The desktop sidecar does not
  bundle the hosted Google Drive SDK.
- Realtime: in-process app events/Tauri commands instead of Supabase realtime.
- Edge functions: Tauri Rust commands plus local Next/API code.

## Gather scheduling
- Durable schedule API: `/api/gather/schedules`.
- Storage: embedded SQLite `gather_schedules` rows.
- Browser UI: `public/screen-gather.jsx` syncs schedules to the API and keeps
  the old localStorage fallback during the route migration.
- Desktop scheduler: the Tauri production launcher starts a local background
  timer after the packaged Next server is ready. It calls
  `/api/gather/schedules/run-due` every minute; the route computes due
  once/daily/weekly schedules, runs the same server-side Gather pipeline used by
  manual runs, and stamps `last_run_at` / `last_status` on the schedule.
- Browser scheduler: web/dev fallback only. The browser interval exits early
  when the Tauri desktop bridge is present, so desktop builds do not double-run
  scheduled Gather jobs.

## Remaining migration work
- Remove hosted-only dependencies and Postgres/Supabase migrations once hosted web
  compatibility is no longer required.

## Release QA
For local QA builds, run:

```bash
npm run desktop:build
npm run desktop:verify-release
npm run desktop:verify-installed
```

The verifier checks that the macOS app and DMG exist, the bundle metadata uses
the King’s Press name/id/version, the packaged Next server and bundled Node
runtime are present at paths the Tauri launcher can resolve, no `.env` files are
bundled, startup browser assets are local rather than CDN-backed, macOS
codesigning verifies, the DMG passes `hdiutil imageinfo`, the DMG mounts with
the app payload plus `/Applications` shortcut, and the packaged server can boot
from a minimal environment with a fresh local SQLite data directory, serve the
UI, report LLM/media-provider status, start with no default campaigns, create a
blank first campaign, and run the Gather scheduler endpoint.

`desktop:verify-installed` mounts the built DMG, copies the app payload into a
temporary Applications folder, launches that copied app through macOS
LaunchServices with a fresh app-data directory, and verifies that the copied app
starts its bundled server, defaults to local-first model settings, exposes media
provider status, creates SQLite locally, and starts with no campaigns. It uses a
fresh launch so macOS saved-window restoration cannot mask an app-icon boot
regression.

Developer ID signing and Apple notarization use:

```bash
npm run desktop:build:signed
npm run desktop:verify-signed-release
```

`desktop:build:signed` refuses to run unless it can use either
`KINGS_PRESS_SIGNING_IDENTITY`, `APPLE_SIGNING_IDENTITY`, or
`MACOS_SIGNING_IDENTITY`, or an importable `APPLE_CERTIFICATE` plus
`APPLE_CERTIFICATE_PASSWORD`. It also requires notarization credentials through
either `APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH` or
`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`. Local release work can instead
use a saved `notarytool` keychain profile via
`APPLE_NOTARY_KEYCHAIN_PROFILE` or `KINGS_PRESS_NOTARY_KEYCHAIN_PROFILE`. Before
Tauri notarizes the app, the signed build signs packaged native Node resources
such as `.node` addons, `.dylib` libraries, and the bundled Node runtime; Node is
signed with the V8/JIT entitlements in
`src-tauri/macos-node-entitlements.plist`. The signed build also submits and
staples the DMG. The signed verifier additionally requires a non-ad-hoc
Developer ID signature, a stapled app notarization ticket, and a passing
Gatekeeper install assessment for the DMG.
