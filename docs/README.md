# King's Press Editorial Desk

King's Press Editorial Desk is the local-first desktop publishing and editorial
operations app. It packages the editorial workflow into a Tauri app that runs a local
Next.js server, stores data in SQLite, writes generated assets to local app-data
storage, and uses local models by default.

## Read In This Order

1. `DESKTOP_LOCAL_FIRST.md` - desktop architecture, packaging, local database,
   Supabase replacement, Gather scheduling, and release QA.
2. `LOCAL_DEV.md` - browser dev, desktop dev, desktop build, and LLM
   configuration examples.
3. `BUILD_BRIEF.md` - feature scope and acceptance criteria.
4. `API_SPEC.md` - route contracts.
5. `DATA_MODEL.md` - entity relationships and hosted compatibility notes.

## Runtime Shape

| Layer | Desktop default |
|---|---|
| Shell | Tauri |
| Web/API runtime | Packaged Next.js standalone server |
| Database | SQLite in the app data directory |
| Storage | Local app-data files served through `/api/local-files/...` |
| Auth | Embedded local owner/workspace |
| Browser shell | Local bundled React/Babel runtime and system fonts |
| LLM | Local-first provider-neutral layer |
| Scheduling | Tauri-started background Gather scheduler |
| Installer artifact | macOS `.app` + DMG |

Hosted Postgres/Supabase compatibility still exists for legacy/web testing, but
it is not the normal desktop path.

The desktop sidecar is trimmed for local-first use: hosted Google Drive SDK
packages are not bundled, while local export/save routes remain available.

## Model Setup

The first-run desktop setup supports:

- Ollama native local models,
- starting an existing Ollama install,
- pulling/selecting an Ollama model,
- Docker Model Runner via its OpenAI-compatible endpoint,
- optional hosted API-key providers: OpenAI/ChatGPT, Anthropic, Gemini,
  xAI/Grok, and generic OpenAI-compatible services.
- multiple provider profiles plus per-task defaults, so Gather/Weave can stay
  local while draft, review, revision, utility, or media-prompt work uses a
  selected cloud provider.

The app can run without cloud compute when a local model is available.

The desktop browser shell is also packaged for offline startup: it does not
fetch React, Babel, or fonts from CDNs during launch.

## Release Checks

For local QA builds:

```bash
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build
npm run desktop:verify-release
npm run desktop:verify-installed
```

Developer ID signing and Apple notarization are supported on macOS with:

```bash
npm run desktop:build:signed
npm run desktop:verify-signed-release
```
