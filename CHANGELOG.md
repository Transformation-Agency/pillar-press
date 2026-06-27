# Changelog

All notable changes to Pillar Press are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Studio integrations: connect **Hedra** (video/avatars) and **ElevenLabs**
  (voiceovers) directly in-app via a reusable connect card. Keys are verified
  against the provider, then stored encrypted in the desktop settings. Cards
  appear in the Studio media dialog, the model setup modal's Integrations
  section, and the first-run Connect step.
- Desk chat **Retry** button to re-run a failed message without retyping.
- LM Studio first-run setup option (OpenAI-compatible local server).

### Changed
- Desk system prompt now writes full-length drafts when asked, while keeping
  short replies for editorial back-and-forth (previously always terse).
- Desk context meter reads the **actual** loaded context length from LM Studio
  instead of guessing from the model name, so long threads no longer fold
  prematurely.
- Model setup is the single source of truth for LLM routing: the dev
  `.env.example` no longer seeds `LLM_PROVIDER`/`LLM_MODEL`/`LLM_BASE_URL`
  overrides that silently shadowed the in-app settings.
- Media config errors point users to **Settings → Studio integrations** instead
  of naming server environment variables.
- The Utility model task is labeled to note it also powers Desk chat.
- Public repo cleanup: legacy predecessor branding removed from docs, examples,
  runtime environment names, and the desktop bridge.

### Fixed
- **Library piece deletion** worked again on desktop — it used a native
  `confirm()` dialog, which is a silent no-op in the Tauri webview, so deletes
  never ran. Replaced with an in-app confirmation modal.
- **Book creation** on desktop — `prompt()` was likewise a no-op; replaced with
  an in-app naming modal.
- Library auto-title and Workspace draft-upload errors now surface inline
  instead of via swallowed `alert()` calls.
- Gather no longer crashes on an unknown source kind (falls back to a default
  label/icon).
- Review polling has a deadline and re-entry guard so a hung review can't spin
  forever or spawn parallel polls.
- Studio guards generation while the model catalog is still loading.

## [0.1.0] — 2026-06-09

Initial local-first desktop release.

### Added
- **Editorial pipeline**: draft → seven-gate review → proposed revision →
  platform outputs, plus Weave multi-source synthesis and per-platform condense.
- **Desk**: durable idea-chat with folded memory and a context meter.
- **Gather**: research connectors (RSS, web search, scrape, PubMed, X, YouTube)
  with durable, SQLite-backed scheduling run by a desktop background scheduler.
- **Studio**: image, audio, and video generation through configured media
  providers.
- **Book Writer**: chapter-by-chapter books that reuse the editorial engine.
- **References / Preferences**: per-campaign strategy, registers, voice rules,
  red lines, and AI-assisted editing.
- **Voice-first onboarding**: conversational first-run setup with local speech
  capture, model setup, and a handoff into the Desk.
- **Local-first runtime**: Tauri desktop app running a packaged Next.js server
  with SQLite, local file storage, encrypted provider settings, and
  secret-redacted local backups.
- **Provider-neutral models**: Ollama, OpenAI-compatible endpoints, OpenAI,
  Anthropic, Gemini, and xAI/Grok behind one prompt layer, with per-task model
  defaults.

[Unreleased]: https://github.com/Transformation-Agency/pillar-press/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Transformation-Agency/pillar-press/releases/tag/v0.1.0
