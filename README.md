# King's Press Editorial Desk

King's Press Editorial Desk is a local-first editorial operations app for
researching, drafting, reviewing, revising, weaving, and producing publication
work. It packages a Next.js server inside a Tauri desktop app, stores app data in
SQLite, writes generated files to local app-data storage, and uses local models
by default.

Cloud providers are optional. You can run the app with Ollama or Docker Model
Runner locally, or link hosted providers such as OpenAI/ChatGPT, Anthropic,
Gemini, xAI/Grok, or OpenAI-compatible services. Provider profiles and per-task
defaults let you use different models for Gather, Weave, draft, review,
revision, utility, and media-prompt work.

## Highlights

- Local-first desktop app with Tauri.
- Packaged Next.js 15 App Router API/runtime.
- SQLite desktop database, with hosted Postgres/Supabase compatibility kept for
  legacy web testing.
- Local app-data storage for generated files and exports.
- Provider-neutral LLM layer with local and hosted adapters.
- Optional Studio media integrations for image, voice, and video providers.
- First-run model setup for Ollama, Docker Model Runner, and hosted API keys.
- No default campaigns in a clean install.
- macOS local QA, Developer ID signing, and notarization scripts.

## Requirements

- Node.js 20+ and npm.
- Rust + Cargo for Tauri desktop builds.
- Ollama or Docker Model Runner for local model use, unless you choose hosted
  providers.
- macOS for macOS app/DMG builds and Apple notarization.

## Quick Start

```bash
npm install
cp .env.example .env
ollama pull llama3.2
npm run dev
```

Open http://localhost:3000.

For the desktop app:

```bash
npm run desktop:dev
```

## Build

```bash
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build
npm run desktop:verify-release
```

Developer ID signed and notarized macOS release builds use:

```bash
npm run desktop:build:signed
npm run desktop:verify-signed-release
```

Signing requires Apple Developer credentials in environment variables. See
[docs/DESKTOP_LOCAL_FIRST.md](docs/DESKTOP_LOCAL_FIRST.md) for details.
For local release work, the safest path is a saved `notarytool` keychain
profile exposed as `APPLE_NOTARY_KEYCHAIN_PROFILE`, so app-specific passwords do
not need to be stored in shell history or committed scripts.

## Documentation

- [Desktop architecture](docs/DESKTOP_LOCAL_FIRST.md)
- [Local development](docs/LOCAL_DEV.md)
- [Build brief](docs/BUILD_BRIEF.md)
- [API spec](docs/API_SPEC.md)
- [Data model](docs/DATA_MODEL.md)

## Security

Do not commit `.env` files or provider keys. The desktop app stores provider
settings locally and redacts secrets from local backups.

## License

MIT. See [LICENSE](LICENSE).
