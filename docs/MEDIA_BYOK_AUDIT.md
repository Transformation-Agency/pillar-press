# Hosted Media BYOK Audit

Status: audit complete, hosted media BYOK server plumbing implemented, setup/UI polish not complete.

This audit covers `POST /api/hedra/generate` and the media provider helpers that
power Studio image, audio, video, and avatar generation in hosted web mode.

## Current Verdict

Hosted LLM BYOK is real. Hosted media BYOK now has the same encrypted hosted
settings foundation plus server-side generation resolution for Studio media
routes.

The database can store more than LLM secrets because `provider_secrets.kind` is
generic. Hosted media provider settings now read and write `kind = "media"` via
`GET/PUT /api/media/provider-settings`; media generation now prefers saved
hosted BYOK media profiles and falls back to managed env/desktop settings.

## Current Credential Flow

```mermaid
flowchart TD
  Browser["Browser Studio"] --> Generate["POST /api/hedra/generate"]
  Generate --> Reserve["reserveUsage(task=media_generation)"]
  Generate --> MediaConfig["get*ProviderForUser(user)"]
  MediaConfig --> HostedMedia["Encrypted provider_secrets kind=media"]
  MediaConfig --> Env["Managed server env MEDIA_* / provider API keys"]
  MediaConfig --> Desktop["desktopMediaProvider() in local-first desktop"]
  Generate --> HedraClient["lib/hedra.ts"]
  HedraClient --> HedraKey["BYOK Hedra key or managed Hedra key"]
  Generate --> ElevenClient["textToSpeechLong()"]
  ElevenClient --> ElevenKey["BYOK ElevenLabs key or managed ElevenLabs key"]
  Generate --> LLMPrompt["getAIForTaskForUser(mediaPrompt)"]
  LLMPrompt --> LLMByok["Hosted LLM BYOK profile works here"]
  Generate --> Usage["usage_events providerSource/profileId metadata"]
  Generate --> MediaJob["media_jobs persisted by workspace/user with secret-free media metadata"]
```

## What Already Works

- Media jobs are persisted with `userId`, `workspaceId`, `campaignId`, and
  `sourceContentId`.
- Media generation reserves hosted usage before provider work.
- Supabase storage uploads reserve hosted storage quota when a hosted user is
  passed through.
- The optional image prompt enhancement now uses `getAIForTaskForUser("mediaPrompt")`,
  so the LLM part of media generation can use hosted LLM BYOK.
- Hosted Hedra credit checks and hosted Eleven/Hedra catalog calls now respect
  managed/BYOK provider access gates before touching platform or user provider
  keys.
- Hosted media provider keys can now be saved as encrypted `provider_secrets`
  rows with `kind = "media"` for `hedra`, `elevenlabs`, `openai`, `xai`, and
  `custom-image`. Browser reads receive only secret-free metadata.
- `lib/mediaProviders.ts` now resolves hosted media providers per user,
  preferring saved BYOK media profiles and falling back to managed env/desktop
  settings.
- `POST /api/hedra/generate` now uses saved BYOK media profiles for OpenAI/xAI
  compatible image generation, OpenAI audio generation, Hedra image/video/avatar
  generation, and ElevenLabs voiceover audio used in Hedra videos.
- Hedra model/status/asset operations and ElevenLabs TTS accept per-request API
  key overrides.
- `GET /api/media/providers` merges managed availability with hosted saved BYOK
  media provider status.
- Media usage reservations now mark BYOK media generation with
  `providerSource: "byok"` and profile metadata where applicable.

## Gaps

### 1. Setup still prefers the desktop bridge

The setup helper calls `desktop.saveMediaProviderKey()` in desktop mode. Hosted
web mode now has a matching encrypted settings route, but the setup/onboarding
UI still needs to consistently use it for media provider keys.

Impact: hosted onboarding can test some user-supplied keys and has a route to
persist them, but does not yet reliably feed them into media generation.

### 2. Studio UI does not yet expose media profile management cleanly

`GET /api/media/providers` now returns user-aware status, but the hosted Studio
and setup UI still need a clear media provider settings surface that writes to
`/api/media/provider-settings`.

Impact: the backend can use hosted BYOK media profiles, but the user journey for
adding, testing, selecting, and rotating those media keys is not production
quality yet.

### 3. Live provider smoke coverage is still needed

Automated tests prove resolver behavior, secret-free responses, and BYOK usage
reservation shape. They do not prove live provider behavior against Hedra,
ElevenLabs, OpenAI image/audio, xAI image, and custom image endpoints.

Impact: before launch, run a hosted staging smoke with real BYOK keys for each
supported provider and confirm generated assets persist beyond signed provider
URL expiry.

## Required Implementation Order

1. Add hosted media provider settings. **Implemented.**
   - Reuse `provider_secrets` with `kind = "media"`.
   - Add schemas for `hedra`, `elevenlabs`, `openai`, `xai`, and
     `custom-image`.
   - Store provider, label, base URL, optional default model ids, and encrypted
     API key.

2. Add server routes for hosted media settings. **Implemented.**
   - Recommended route: `GET/PUT /api/media/provider-settings`.
   - Browser must receive only secret-free metadata.
   - PUT must require authenticated hosted user and BYOK-provider entitlement.

3. Add a user-scoped media resolver. **Implemented.**
   - Recommended API:
     `getMediaProviderForUser(provider, capability, user)`.
   - Return `{ config, providerSource, provider, model, profileId }`.
   - Hosted mode should prefer saved BYOK media profile, then managed env only
     when plan allows managed providers.
   - Desktop/local-first should keep env/desktop behavior.

4. Add API-key override support to media clients. **Implemented.**
   - `lib/hedra.ts`: add optional `{ apiKey }` to model listing, asset create,
     upload, generation, generation status, asset listing, and asset URL lookup.
   - `lib/elevenlabs.ts`: add `apiKey` to `TtsInput`, `textToSpeech()`, and
     `textToSpeechLong()`.

5. Wire `POST /api/hedra/generate` through the resolver. **Implemented.**
   - OpenAI/xAI/custom image path uses hosted BYOK config when selected.
   - OpenAI audio path uses hosted BYOK config when selected.
   - Hedra image/video/avatar path uses hosted BYOK Hedra key when selected.
   - ElevenLabs voiceover paths use hosted BYOK ElevenLabs key when selected.
   - All usage reservations include `providerSource`, `provider`, `model`, and
     `profileId`.

6. Update provider status and setup UI. **Partially implemented.**
   - `GET /api/media/providers` should merge managed availability with
     user-saved hosted media BYOK status.
   - Onboarding/setup should save media keys through the hosted media settings
     route when not running in desktop local-first mode.

7. Add tests. **Started.**
   - Media settings encryption tests for `kind = "media"`.
   - Route tests proving hosted media generation uses BYOK keys without reading
     env keys.
   - Route tests proving managed media generation requires managed-provider
     access.
   - Route tests proving BYOK media generation requires BYOK-provider access.
   - Regression tests proving secrets never appear in status responses, errors,
     or media job metadata.

## Acceptance Criteria

- A hosted user can add and save a Hedra key, ElevenLabs key, OpenAI media key,
  xAI media key, or custom image provider key without exposing it to the
  browser after save.
- Studio status reflects those saved providers.
- Image generation can run from a hosted user-saved OpenAI/xAI/custom key.
- Audio generation can run from a hosted user-saved OpenAI or ElevenLabs key.
- Hedra image/video/avatar generation can run from a hosted user-saved Hedra
  key.
- Hedra avatar/video voiceover can combine hosted user-saved ElevenLabs and
  Hedra keys.
- Usage events distinguish managed media generation from BYOK media generation.
- Plans can allow BYOK media while denying managed media.
- Desktop/local-first media behavior remains unchanged.
