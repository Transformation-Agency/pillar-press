# CLAUDE.md - Working Instructions For King's Press

You are building **King's Press Editorial Desk**, the local-first editorial
operations desktop app. The target product is a Tauri desktop app that runs a
packaged Next.js server locally, stores app data in SQLite, keeps generated files
in local app-data storage, and uses local models by default.

Read these before making architecture changes:

1. `docs/DESKTOP_LOCAL_FIRST.md`
2. `docs/LOCAL_DEV.md`
3. `docs/BUILD_BRIEF.md`
4. `docs/API_SPEC.md`
5. `docs/DATA_MODEL.md`

## Ground Rules

- **Local-first is the product default.** Desktop builds should not require
  Supabase, Postgres, Docker, Vercel, or cloud model keys for normal operation.
  Hosted compatibility can remain, but it must not leak into the normal desktop
  path.
- **Keep the editorial behavior stable.** The gate prompts, platform generation
  order, weave map-reduce, revision rules, delimiters, JSON schemas, and parser
  repair behavior are product behavior. Preserve them unless the product owner
  explicitly asks to change editorial output.
- **Secrets stay server-side or native-side.** LLM keys, Hedra/ElevenLabs keys,
  OAuth secrets, and provider tokens must not be exposed through browser globals,
  client bundles, logs, route responses, or backup exports.
- **Model access goes through `lib/llm`.** Do not add direct provider calls in
  feature code. Use the provider-neutral interface so Ollama, Docker Model
  Runner, OpenAI-compatible endpoints, OpenAI/ChatGPT, Anthropic, Gemini, and
  xAI/Grok keep working behind the same prompt layer.
- **SQLite/local storage must stay first-class.** API routes that touch data or
  generated files need a local-first branch when `KINGS_PRESS_LOCAL_FIRST=true`,
  `DATA_BACKEND=sqlite`, or a local database path is configured.
- **Use migrations and schema updates intentionally.** Drizzle/Postgres files
  remain for hosted compatibility. The desktop schema is
  `db/local-sqlite-schema.sql`; keep it aligned with local API behavior.
- **Do not deploy or push unless asked.** Work on feature branches and keep
  release artifacts local unless the user explicitly requests publication.

## Desktop Build Order

1. Preserve the packaged Next standalone server and bundled Node runtime path.
2. Keep Tauri launcher resource lookup compatible with packaged app resource
   layouts.
3. Keep first-run setup usable for non-technical users:
   - install or open Ollama setup,
   - start an existing Ollama install,
   - list and pull Ollama models,
   - list Docker Model Runner models,
   - save optional cloud API-key settings.
4. Keep local backups consistent and secret-redacted.
5. Keep Gather scheduling durable in SQLite and run due jobs from the desktop
   background scheduler.
6. Run the desktop verifier after packaging changes.

## Definition Of Done For The Desktop Product

- The app is branded **King's Press Editorial Desk** in UI, bundle metadata,
  installer artifacts, menus, docs, and normal-user onboarding.
- `npm run desktop:build` produces a Tauri `.app` and DMG.
- The app launches from the packaged `.app`, starts its local server, initializes
  SQLite, starts with no default campaigns, and serves the UI without a developer
  server.
- First-run model setup supports local-first Ollama, existing Ollama installs,
  Docker Model Runner, optional hosted API keys, multiple provider profiles, and
  per-task LLM defaults.
- `npm run desktop:verify-release` passes for local QA builds.
- Developer ID signing/notarization is supported by `npm run desktop:build:signed`;
  signed artifacts must pass `npm run desktop:verify-signed-release`.
- `npm run typecheck`, `npm test`, and native Rust tests pass.
