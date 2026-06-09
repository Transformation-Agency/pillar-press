# Local Development

King's Press Editorial Desk is local-first by default. You do not need Docker,
Supabase, or Postgres for normal desktop development.

## Prerequisites
- Node 20+ and npm.
- Rust + Cargo for Tauri builds.
- Ollama for local AI: https://ollama.com/download

Optional hosted integrations such as Anthropic, Hedra, ElevenLabs, Brave Search,
YouTube, Google Drive, and the hosted Postgres/Supabase compatibility path still
use environment keys when you choose to test them.

## Browser Dev
```bash
npm install
cp .env.example .env
ollama pull llama3.2
npm run dev
```

Open http://localhost:3000. With the default `.env.example`, the app uses:
- SQLite in `.local-data/kings-press.sqlite3`.
- Local app-data storage under `.local-data/storage`.
- Ollama native chat at `http://127.0.0.1:11434`.
- A single embedded local owner/workspace with no default campaigns. Create the
  first campaign from the app shell.

## Desktop Dev
```bash
npm run desktop:dev
```

The desktop runtime starts the local Next server with local-first env values and
shows first-run setup in the app. Setup lets a user install Ollama, use an
existing Ollama install, connect to Docker Model Runner at
`http://localhost:12434/engines/v1`, or add a hosted provider API key. Ollama
setup stores the selection only after the selected local model is available.
Docker Model Runner setup stores the selection only after the app can list
models from the configured local endpoint.

The desktop app looks for Ollama through `OLLAMA_BIN`, common Homebrew install
paths, and then the process `PATH`. Set `OLLAMA_BIN=/path/to/ollama` only if you
use a nonstandard Ollama install.

Desktop setup completion is based on the native app-data
`desktop-settings.json` model/provider choice. Browser localStorage mirrors that
state for convenience, but the saved native settings file is the durable source
after backup restore or WebView storage reset. The completion check is
provider-aware: Ollama must be running with the selected model installed, Docker
Model Runner must list the selected model, and cloud providers must still have
their required key/base URL values. Restored cloud backups reopen setup because
backup creation redacts provider keys.

Native desktop menu items include:
- **Set Up Local Model...**
- **Start Ollama**
- **Open Data Folder**
- **Create Local Backup**
- **Open Backups Folder**
- **Install Ollama...**

Local backups include SQLite data, local storage, desktop settings with secret
fields nulled out, and a `backup-manifest.json` describing the app version,
creation timestamp, included files, and redaction policy. Saved provider API
keys are not copied into backup folders.

## Desktop Build
```bash
npm run desktop:icon
npm run desktop:build
```

The build creates a Tauri app and macOS DMG under `src-tauri/target/release/bundle`.
The packaged app includes:
- The standalone Next server.
- A bundled Node runtime copied from the build machine.
- The local SQLite schema.
- App icons and an ad-hoc signed macOS bundle for local QA.

Local QA uses the ad-hoc signed build path below.

Verify the built artifact:
```bash
npm run desktop:verify-release
npm run desktop:verify-installed
```

`desktop:verify-installed` tests the user-facing installer path: it mounts the
DMG, copies the app into a temporary Applications folder, launches the copied app
through macOS LaunchServices, and verifies a fresh local SQLite app-data
directory with no default campaigns.

Developer ID signing and Apple notarization use the stricter signed path:
```bash
npm run desktop:build:signed
npm run desktop:verify-signed-release
```

## LLM Configuration
`GET /api/llm/status` reports the active provider/model and capabilities without
exposing secrets.

Local-first remains the default. Cloud providers are opt-in and use the same
server-side LLM interface.

The desktop setup screen can save these choices to the local app data settings
file. No `.env` editing is required for normal desktop use. It supports multiple
linked profiles and task defaults, so Gather/Weave can use a local model while
drafting, review, revision, utility, and media-prompt tasks use any configured
cloud provider.

For browser/dev runs, task env vars can override the global default:
```bash
LLM_TASK_GATHER_PROVIDER=ollama
LLM_TASK_GATHER_MODEL=llama3.2
LLM_TASK_WEAVE_PROVIDER=ollama
LLM_TASK_WEAVE_MODEL=llama3.2
LLM_TASK_DRAFT_PROVIDER=openai
LLM_TASK_DRAFT_MODEL=gpt-4o-mini
LLM_TASK_DRAFT_API_KEY=<openai-api-key>
LLM_TASK_REVIEW_PROVIDER=xai
LLM_TASK_REVIEW_MODEL=grok-4.3
LLM_TASK_REVIEW_API_KEY=<xai-api-key>
LLM_TASK_REVISION_PROVIDER=anthropic
LLM_TASK_REVISION_MODEL=claude-haiku-4-5
LLM_TASK_REVISION_API_KEY=<anthropic-api-key>
```

Ollama native local:
```bash
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
LLM_BASE_URL=http://127.0.0.1:11434
```

LM Studio / vLLM / Ollama OpenAI-compatible local:
```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=local-model
LLM_BASE_URL=http://127.0.0.1:1234/v1
LLM_API_KEY=
```

Docker Model Runner local:
```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=ai/smollm2
LLM_BASE_URL=http://localhost:12434/engines/v1
LLM_API_KEY=
```

Anthropic hosted:
```bash
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5
LLM_API_KEY=sk-ant-...
ANTHROPIC_API_KEY=sk-ant-...
```

OpenAI / ChatGPT API:
```bash
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=<openai-api-key>
```

OpenAI-compatible hosted:
```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=<provider-api-key>
```

xAI / Grok:
```bash
LLM_PROVIDER=xai
LLM_MODEL=grok-4.3
XAI_API_KEY=<xai-api-key>
```

Gemini:
```bash
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
GEMINI_API_KEY=...
```

PDF/image extraction needs a multimodal file provider. Text and `.docx` uploads
are decoded locally. Anthropic and Gemini can be used as hosted multimodal
fallbacks:
```bash
LLM_FILE_PROVIDER=anthropic
LLM_FILE_MODEL=claude-haiku-4-5
LLM_FILE_API_KEY=sk-ant-...
```

```bash
LLM_FILE_PROVIDER=gemini
LLM_FILE_MODEL=gemini-2.5-flash
LLM_FILE_API_KEY=...
```

## Studio Media Providers
Studio media providers are optional and server-side. The browser never stores
Hedra, ElevenLabs, OpenAI, xAI/Grok, or custom media keys. `GET
/api/media/providers` reports configured providers and capabilities without
returning secrets.

Voice:
```bash
ELEVENLABS_API_KEY=...
```

Hedra image/video/avatar:
```bash
HEDRA_API_KEY=...
```

OpenAI image generation:
```bash
MEDIA_OPENAI_API_KEY=<openai-api-key>
MEDIA_OPENAI_BASE_URL=https://api.openai.com/v1
MEDIA_OPENAI_IMAGE_MODELS=gpt-image-1
MEDIA_OPENAI_AUDIO_MODELS=gpt-4o-mini-tts,tts-1
```

xAI / Grok image generation:
```bash
MEDIA_XAI_API_KEY=<xai-api-key>
MEDIA_XAI_BASE_URL=https://api.x.ai/v1
MEDIA_XAI_IMAGE_MODELS=grok-2-image
```

Custom OpenAI-compatible image endpoint:
```bash
MEDIA_IMAGE_BASE_URL=https://provider.example/v1
MEDIA_IMAGE_API_KEY=...
MEDIA_IMAGE_MODELS=model-a,model-b
```

## Hosted Compatibility
The repo still contains the old hosted web stack for compatibility. To exercise
that path, configure `DATABASE_URL`, `SUPABASE_URL`, Supabase keys, and set
local-first variables off. Do not run Drizzle push/generate against a local-first
desktop database.

## Useful Commands
```bash
npm run typecheck
npm test
cargo check --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```
