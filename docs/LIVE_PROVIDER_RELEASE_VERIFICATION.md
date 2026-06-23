# Live Provider Release Verification

This runbook covers the remaining release-blocker rows in
`docs/kings-press-feature-status.xlsx`:

- `PROV-004` OpenAI key can seed voice defaults
- `MEDIA-002` Studio image/video/avatar/audio generation
- `AUDIO-001` Text-to-speech actions

The verifier starts the packaged King’s Press desktop server in an isolated temp
app-data directory. It does not read or modify the user’s installed desktop
database or settings.

## Safety Rules

- Do not paste provider keys into files.
- Pass keys only through environment variables for the one command invocation.
- The script redacts key-shaped values from output and fails if a route response
  returns a supplied key.
- By default the script does not run provider generation calls that spend
  credits. It lists/tests providers only.
- Generation calls require:

```sh
KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes
```

## Build Prerequisite

The packaged desktop server resources must exist:

```sh
npm run desktop:web:build
```

or:

```sh
npm run desktop:build
```

## No-Credit Provider Readiness

Local Ollama/Gemma readiness runs by default and does not require cloud keys:

```sh
npm run desktop:verify-live-providers
```

Optional local model override:

```sh
KINGS_PRESS_LIVE_OLLAMA_MODEL="gemma4:26b-mlx" \
KINGS_PRESS_LIVE_OLLAMA_BASE_URL="http://127.0.0.1:11434" \
npm run desktop:verify-live-providers
```

OpenAI LLM/media readiness:

```sh
KINGS_PRESS_LIVE_OPENAI_API_KEY="..." \
npm run desktop:verify-live-providers
```

Optional model overrides:

```sh
KINGS_PRESS_LIVE_OPENAI_CHAT_MODEL="gpt-4o-mini" \
KINGS_PRESS_LIVE_OPENAI_IMAGE_MODEL="gpt-image-1" \
KINGS_PRESS_LIVE_OPENAI_AUDIO_MODEL="gpt-4o-mini-tts" \
KINGS_PRESS_LIVE_OPENAI_API_KEY="..." \
npm run desktop:verify-live-providers
```

ElevenLabs voice readiness:

```sh
KINGS_PRESS_LIVE_ELEVENLABS_API_KEY="..." \
npm run desktop:verify-live-providers
```

Hedra model readiness:

```sh
KINGS_PRESS_LIVE_HEDRA_API_KEY="..." \
npm run desktop:verify-live-providers
```

Multiple providers can be checked in one run by setting multiple env vars.

## Credit-Spending Verification

This is the release-gate proof for provider-backed media/TTS:

```sh
KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes \
KINGS_PRESS_LIVE_OPENAI_API_KEY="..." \
KINGS_PRESS_LIVE_ELEVENLABS_API_KEY="..." \
KINGS_PRESS_LIVE_HEDRA_API_KEY="..." \
npm run desktop:verify-live-providers
```

The script currently performs:

- Local Ollama model listing and `/api/llm/test`
- Local Ollama task-default `/api/llm/util` call through an isolated desktop
  settings file
- OpenAI chat model listing and `/api/llm/test`
- OpenAI media-provider configured check
- OpenAI image generation through `/api/hedra/generate`
- OpenAI saved TTS generation through `/api/hedra/generate`
- ElevenLabs voice listing
- ElevenLabs saved TTS generation when a voice is available
- Hedra model listing

Hedra video/avatar generation is intentionally left as manual verification
because it is slower and credit-heavy. If it is required for the release, record
the exact manual evidence in the tracker and issue #42.

## Updating Release Evidence

After a successful run:

1. Copy the redacted JSON summary into issue #42.
2. Update `docs/kings-press-feature-status.xlsx`:
   - `PROV-004` when OpenAI model listing and `/api/llm/test` pass.
   - `MEDIA-002` when image/video/avatar/audio requirements are verified or
     explicitly waived.
   - `AUDIO-001` when saved provider-backed TTS generation passes or is
     explicitly waived.
3. Run:

```sh
npm run desktop:release-readiness
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:verify-release
npm run desktop:verify-installed
```

`npm run desktop:release-readiness` reads the canonical tracker and intentionally
fails while any unwaived local-first release rows remain blocked, failed, or not
independently verified. Hosted-auth rows marked out of local-first scope are
reported in counts but do not block desktop notarization.

Only after the tracker has no unwaived release blockers should signed/notarized
dual-arch release DMGs be built and uploaded.
