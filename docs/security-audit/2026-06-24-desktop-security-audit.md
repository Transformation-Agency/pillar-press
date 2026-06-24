# King's Press Desktop Security Audit - 2026-06-24

Status: not ready for broad production release until the Tauri webview/native boundary is tightened.

This audit covers the local-first desktop app security model: Tauri config and capabilities, native commands, packaged localhost server, filesystem access, shell execution, provider/OAuth secrets, local SQLite/storage, CSP, bundled runtime, and external network calls. It is a technical security assessment, not human release approval.

## Threat Model

Assets:

- Local SQLite database: campaigns, pieces, references, recipients, letter workflows, media metadata.
- Local storage directory: generated images, audio/video, uploaded/extracted files, exported artifacts.
- Desktop settings: encrypted LLM/media provider API keys and provider defaults.
- Desktop encryption key: Keychain-backed in normal macOS use, local fallback file when Keychain is disabled or a custom desktop data dir is used.
- Provider spend authority: OpenAI, xAI/Grok, Anthropic, Gemini, ElevenLabs, Hedra, Ollama, Docker Model Runner, and custom/OpenAI-compatible endpoints.
- Google Drive refresh tokens in hosted mode.
- Native authority exposed to the webview: starting/pulling Ollama, creating/opening backups, saving model/media settings, speech, runtime status.

Trust boundaries:

- Tauri native shell <-> webview JavaScript through the bundled `window.KINGS_DESKTOP` bridge and custom IPC commands.
- Webview static frontend <-> packaged Next server on a random `127.0.0.1` port.
- Next server <-> local SQLite/storage and desktop settings files.
- Next server <-> external providers and hosted OAuth/billing APIs.
- User-imported files/model outputs <-> rendered React UI.

Primary attacker models:

- Malicious content that becomes script execution in the webview through an XSS bug, compromised bundled asset, dependency bug, or future unsafe rendering change.
- A local process or browser page that can reach the random localhost server port.
- A compromised provider/custom endpoint that tries to exfiltrate saved API keys or user content.
- A malicious local user/process reading app-data files directly.
- Hosted attacker without auth attempting admin/job/webhook/provider SSRF abuse.

## Confirmed Findings

### SEC-001 - Partially fixed: broad Tauri native authority is exposed to the main webview

Severity before follow-up hardening: High. Current residual severity: Medium.

Evidence:

- `src-tauri/tauri.conf.json:14` now disables `withGlobalTauri`; the frontend uses a bundled bridge built from `@tauri-apps/api`.
- `src-tauri/tauri.conf.json:26` now uses `script-src 'self'`; the prior `unsafe-eval` allowance was removed after JSX precompilation.
- `src-tauri/capabilities/default.json:6`-`8` still grants the main window permissions to `http://127.0.0.1:*`, but `src-tauri/src/main.rs` now adds a native navigation guard that allows only app URLs, the active packaged-server port, and the configured development server.
- `src-tauri/permissions/desktop-setup.toml:4`-`20` exposes commands for provider settings, backups, Ollama pulls, runtime status, and speech.
- `public/index.html` now loads `public/build/app.compiled.js`; runtime Babel is no longer loaded in production.
- `src-tauri/macos-node-entitlements.plist:5`-`8` grants JIT and unsigned executable memory.

Impact:

If script execution occurs in the webview, the attacker can call the native bridge. The commands do not provide arbitrary shell execution, but they can write model/media settings, create/open backups, disclose local path metadata through runtime status, start/pull Ollama models, and drive provider-spend workflows through same-origin APIs. The blast radius is broader than a normal web XSS because the webview has native IPC authority.

Recommended fix:

- Keep the static JSX frontend precompiled and keep the release verifier failing on runtime Babel or `unsafe-eval` regressions.
- Continue working toward removing `unsafe-inline` from styles where feasible.
- Keep `withGlobalTauri` disabled and keep the app-owned bridge narrowly scoped to the desktop commands the UI needs.
- Replace wildcard `http://127.0.0.1:*` capability with a tighter origin strategy. Preferred: custom protocol or app-local origin that can be statically scoped. If the localhost server remains dynamic, add a navigation guard and do not grant IPC to arbitrary loopback pages.
- Split `desktop-setup` into smaller permissions so settings writes, backup creation, and model pulls are not all available to every setup UI state.
- After removing Babel/JIT needs, remove `allow-jit` and `allow-unsigned-executable-memory`.

### SEC-002 - Fixed: official provider keys could be paired with caller-supplied desktop base URLs

Severity before fix: High. Fixed in this pass.

Evidence before fix:

- Native `save_llm_settings` accepted provider/profile `baseUrl` values and preserved saved encrypted API keys for provider profiles.
- Native `save_media_provider_key` accepted media `baseUrl` values for official providers.

Impact:

If an attacker gained webview script execution, they could potentially preserve an existing saved OpenAI/xAI key, rewrite the provider base URL to an attacker endpoint, then trigger a model/media request that sends the bearer key to that endpoint.

Fix applied:

- Added `official_provider_base_url` and `clean_desktop_base_url` in `src-tauri/src/main.rs`.
- Official desktop providers are now pinned to their official base URLs during native settings writes: OpenAI, xAI, Anthropic, Gemini.
- `openai-compatible` and `custom-image` remain configurable for local/custom endpoint use.
- Added Rust test `pins_official_provider_base_urls_while_allowing_custom_endpoints`.
- Updated `__tests__/desktop-native-settings.test.ts` to assert the new native hardening helper.

### SEC-003 - Fixed: desktop settings and fallback encryption-key files were not explicitly owner-only

Severity before fix: Medium. Fixed in this pass.

Evidence before fix:

- `desktop-secrets.key` was written with plain `fs::write` on fallback.
- `desktop-settings.json` was written with plain `fs::write` from native settings commands.

Impact:

Normal macOS builds prefer Keychain for the desktop encryption key, but custom data directories or disabled Keychain can create a local key file. Default process umask often protects files, but relying on umask is weaker than setting file permissions explicitly.

Fix applied:

- Added `write_private_file` in `src-tauri/src/main.rs`.
- On Unix/macOS, native writes now set `0600` on fallback encryption-key and desktop-settings files.
- Native tests still pass.

### SEC-004 - Risk: local-first API has no per-launch request secret

Severity: Medium for desktop local compromise; Low for remote web attackers.

Evidence:

- Local-first `requireUser()` resolves a single local owner without cloud auth in `lib/auth.ts:101`-`105`.
- The packaged server binds to `127.0.0.1` and a random port in `src-tauri/src/main.rs:932`-`947`.
- Store requests call same-origin `/api/*` without a desktop request token in `public/store.js:31`-`47`.

Impact:

This is partly intentional for local-first UX. The random loopback port and same-origin browser protections help, but a local process can still access the server if it discovers the port. A malicious website cannot normally read responses because of CORS, but local malware or a browser exploit does not need CORS. The risk is local data mutation/exfiltration by local processes, not remote unauthenticated internet access.

Recommended fix:

- Add a per-launch desktop API token generated by native startup and required by mutating local-first API routes.
- Inject it into the first-party webview only through a narrow bridge or boot endpoint.
- Exempt only harmless health/static routes.
- Include an Origin/Host check for local-first APIs as defense in depth.

### SEC-005 - Risk: native runtime status exposes exact local paths to webview scripts

Severity: Low/Medium.

Evidence:

- `desktop_runtime_status` returns data dir, database path, settings path, bundled node path, and server URL in `src-tauri/src/main.rs:1475`-`1490`.
- The command is allowed by `src-tauri/permissions/desktop-setup.toml:16`.

Impact:

This is useful for support and diagnostics, but it gives any webview script local path intelligence. That increases post-XSS precision for local-data targeting.

Recommended fix:

- Return exact paths only behind an explicit user action such as "Copy diagnostics" or "Open Data Folder".
- For normal UI status, return booleans and labels only.

### SEC-006 - Risk: production app still requires JIT/unsigned executable memory

Severity: Medium; tied to SEC-001.

Evidence:

- `src-tauri/macos-node-entitlements.plist:5`-`8`.
- `public/index.html` no longer includes runtime Babel or JSX sources in production.

Impact:

JIT and unsigned executable memory entitlements weaken macOS hardening. They may be necessary for the bundled Node runtime today, but they should not be treated as the desired production posture.

Recommended fix:

- Precompile browser JSX and verify whether bundled Node can run without these entitlements.
- If Node still requires an entitlement, isolate it to the sidecar binary if possible rather than the app shell.

## Positive Controls Observed

- Tauri does not enable a shell plugin, filesystem plugin, dialog plugin, updater plugin, or arbitrary command plugin in `src-tauri/Cargo.toml`.
- Native command execution is fixed-command based: `security`, `open`/`xdg-open`/`explorer`, `ollama`, bundled `node`, `/usr/bin/say`; no user-controlled shell string interpolation was found.
- Packaged Next server binds `HOSTNAME=127.0.0.1`.
- Local file serving protects against path traversal in `app/api/local-files/[...path]/route.ts`.
- Backups redact settings secrets and include manifest metadata; native tests cover redaction.
- Hosted provider base URLs are validated as public HTTPS and block private/local hosts in `lib/hostedProviderUrls.ts`.
- Hosted provider/media settings return `hasApiKey`, not raw keys.
- Google Drive uses server-side OAuth and `drive.file` scope; local-first desktop Drive linking is disabled.
- Stripe webhook and background job runner require secrets.
- `npm audit --audit-level=moderate` found 0 vulnerabilities.
- Release verifier checks no bundled `.env` files and no remote startup assets.

## Release Decision

Broad production release: no longer blocked by runtime Babel/`unsafe-eval` or global Tauri exposure. Residual native-bridge risk remains because the main webview still has setup/settings/backup IPC permissions.

Trusted/internal notarized release: acceptable with documented risk if the owner accepts the current webview/native boundary risk and distributes only to trusted users.

The concrete key-handling issues found during this audit, SEC-002 and SEC-003,
were fixed locally and verified. Follow-up hardening also removed runtime
Babel/`unsafe-eval` from the desktop shell and added a native navigation guard
around the privileged Tauri webview. Follow-up hardening then disabled global
Tauri exposure and replaced it with a bundled `@tauri-apps/api` bridge.

## Commands Run

- `git status --short --branch --untracked-files=all`
- `rg --files src-tauri`
- targeted `rg` inspections for Tauri IPC, command execution, filesystem access, auth, secrets, external links, and browser injection sinks
- `npm audit --audit-level=moderate` - pass, 0 vulnerabilities
- `cargo fmt --manifest-path src-tauri/Cargo.toml` - pass
- `cargo test --manifest-path src-tauri/Cargo.toml` - pass, 3 tests before follow-up hardening; re-run required after navigation-guard changes
- `npm run typecheck` - pass
- `npm test` - pass, 85 files / 520 tests
- `npm run desktop:build` - pass, local QA app and DMG built
- `npm run desktop:verify-release` - pass

## Gaps Not Yet Verified

- No dynamic XSS fuzzing was run against model-generated/user-imported content.
- No malicious local process test attempted to discover and mutate the random localhost server.
- No macOS permission-denial matrix was re-run in this security audit.
- No signed/notarized build was created in this audit; the build was local QA/ad hoc.
- No `cargo audit` run was performed because the project does not include it as a known script and it was not installed during this bounded pass.

## Next Implementation Slice

1. Split `desktop-setup` into smaller permissions by setup state.
2. Replace wildcard `http://127.0.0.1:*` capability with a tighter local-origin strategy if the desktop server stops using a random port.
3. Remove `allow-jit` and `allow-unsigned-executable-memory` if the bundled Node runtime no longer requires them.
4. Add a per-launch local API token and Origin/Host checks for local-first API mutations.
5. Add a per-launch local API token and Origin/Host checks for local-first API mutations.
6. Re-run `desktop:build`, `desktop:verify-release`, `desktop:verify-installed`, and a targeted XSS-to-native-IPC negative test.
