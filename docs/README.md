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
3. `PRODUCTION_READINESS.md` - release gates, dependency audits, Tauri webview
   boundaries, update posture, and dual-architecture release notes.
4. `CONVERSATIONAL_BOOTSTRAP_RUNTIME.md` - reusable first-run conversation
   runtime, manifest model, activation gates, and next implementation slices.
5. `BUILD_BRIEF.md` - feature scope and acceptance criteria.
6. `API_SPEC.md` - route contracts.
7. `DATA_MODEL.md` - entity relationships and hosted compatibility notes.

## Runtime Shape

| Layer | Desktop default |
|---|---|
| Shell | Tauri |
| Web/API runtime | Packaged Next.js standalone server |
| Database | SQLite in the app data directory |
| Storage | Local app-data files served through `/api/local-files/...` |
| Auth | Embedded local owner/workspace |
| Browser shell | Local bundled React runtime, precompiled static UI, and system fonts |
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
fetch React or fonts from CDNs during launch.

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

`desktop:build:signed` runs the canonical tracker release-readiness gate before
signing or notarizing, and will stop if unwaived desktop release blockers remain.

See `PRODUCTION_READINESS.md` for the full local QA checklist, CI gate list,
dependency audit expectations, and current manual-update posture.
