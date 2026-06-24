# Live Provider Release Verification

This runbook covers the remaining release-blocker rows in
`docs/kings-press-feature-status.xlsx`:

- `PROV-004` OpenAI key can seed voice defaults
- `MEDIA-002` Studio image/video/avatar/audio generation

`AUDIO-001` local-first text-to-speech actions are covered separately by the
macOS system TTS fallback: when no OpenAI or ElevenLabs voice provider is
configured, desktop Save audio uses `/usr/bin/say`, stores an AIFF under local
app-data media storage, and returns a completed local media job. Provider-backed
OpenAI/ElevenLabs audio generation still remains part of `MEDIA-002`.

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

xAI / Grok LLM and image readiness:

```sh
KINGS_PRESS_LIVE_XAI_API_KEY="..." \
npm run desktop:verify-live-providers
```

If the provider key is already saved in the desktop app, the verifier can copy
that encrypted settings file into its isolated temp app-data directory and use
the desktop settings key from Keychain:

```sh
KINGS_PRESS_LIVE_DESKTOP_SETTINGS_PATH="$HOME/Library/Application Support/com.kingspress.editorialdesk/desktop-settings.json" \
npm run desktop:verify-live-providers
```

This path does not print or write raw keys. It is useful for provider catalog and
media-generation checks that can read encrypted desktop media provider settings.
Provider model-listing checks such as xAI/Grok `/models` still require the live
API key as a one-command environment variable because the model-listing route
tests a submitted provider connection directly.

Optional Grok model overrides:

```sh
KINGS_PRESS_LIVE_XAI_CHAT_MODEL="grok-4.3" \
KINGS_PRESS_LIVE_XAI_IMAGE_MODEL="grok-2-image" \
KINGS_PRESS_LIVE_XAI_API_KEY="..." \
npm run desktop:verify-live-providers
```

## Credit-Spending Verification

This is the release-gate proof for provider-backed media/TTS that still remains
under `MEDIA-002`:

```sh
KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes \
KINGS_PRESS_LIVE_DESKTOP_SETTINGS_PATH="$HOME/Library/Application Support/com.kingspress.editorialdesk/desktop-settings.json" \
KINGS_PRESS_LIVE_OPENAI_API_KEY="..." \
KINGS_PRESS_LIVE_XAI_API_KEY="..." \
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
- xAI/Grok model listing and `/api/llm/test`
- xAI/Grok image generation through `/api/hedra/generate`
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
   - Provider-backed audio under `MEDIA-002` when saved OpenAI/ElevenLabs TTS
     generation passes or is explicitly waived.
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

If the owner explicitly waives a provider-key/credit row, set that row's Test
Status to `Waived by owner` and include a `WAIVER:` note in either Test Evidence
or Errors Found with the owner, `YYYY-MM-DD` date, and exact release scope. Rows
marked `Waived by owner` without a dated, owner-scoped `WAIVER:` note still block
release. Example:

```text
WAIVER: Paul approved release on 2026-06-23 for the exact scope of shipping
without live Hedra video generation evidence.
```

Only after the tracker has no unwaived release blockers should signed/notarized
dual-arch release DMGs be built and uploaded. `npm run desktop:build:signed`
also runs this readiness gate before signing/notarization begins.
