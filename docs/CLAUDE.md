# CLAUDE.md - Contributor Notes

King's Press Editorial Desk is a local-first desktop app, not just a hosted
backend. Treat the Tauri desktop runtime, local SQLite database, local storage,
and provider-neutral model layer as the primary product surface.

## Rules Of The Road

- Preserve the existing editorial prompts and output contracts for gates,
  revision, platform outputs, Weave, Gather summaries, image prompts, voice
  scripts, and JSON repair.
- Keep secrets out of browser code. Cloud API keys saved by the desktop setup
  live in the native app data settings file and are passed to the packaged Next
  server through `KINGS_PRESS_LLM_SETTINGS_PATH`.
- Use `lib/llm` for model calls. Feature modules should not know whether the
  active provider is Ollama, Docker Model Runner, OpenAI-compatible, OpenAI,
  Anthropic, Gemini, or xAI/Grok.
- Prefer local-first branches for auth, data, and storage. Supabase/Postgres
  compatibility can remain for hosted testing, but the desktop path must run
  without them.
- Keep Tauri commands small and native-specific. Business logic should remain in
  shared TypeScript when it belongs to the web/API runtime.
- Do not run Drizzle push/generate against the desktop SQLite schema. The local
  schema lives in `db/local-sqlite-schema.sql`.

## Verification

Use the narrowest check that proves the change, then run broader checks for
desktop packaging changes:

```bash
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build
npm run desktop:verify-release
```

Developer ID signing and Apple notarization are supported by
`npm run desktop:build:signed` and verified with
`npm run desktop:verify-signed-release`.
When that work resumes, use:

```bash
npm run desktop:build:signed
npm run desktop:verify-signed-release
```

The signed release path requires Developer ID signing and notarization
credentials. Until that work resumes, a passing local QA build proves the
installable local artifact, not public Gatekeeper distribution readiness.
