# Pillar Press UX Readiness Audit - 2026-06-24

Status: UX ready with warnings.

This audit covers the local-first desktop app, with emphasis on first-run setup, non-happy paths, local provider setup, destructive actions, settings, import/export, and app lifecycle behavior. It is a product-readiness assessment, not human release acceptance.

## Evidence

- Ran `npm run desktop:verify-installed`: pass. The verifier mounted the release-candidate DMG, copied the app payload, launched the copied installed app, completed conversational onboarding, reached the setup handoff, and confirmed the installed app served from `http://127.0.0.1:55768`.
- Ran `npm run onboarding:verify:browser`: pass. Typed and voice-style browser-shell onboarding scenarios both reached a Desk setup handoff; sentiment ratings were 5/5 and 4/5.
- Ran `npm run typecheck`: pass.
- Ran `npm test`: pass, 85 test files and 520 tests.
- Inspected `public/setup-helper.jsx`, `public/onboarding-audio.js`, `public/screen-desk.jsx`, `public/screen-library.jsx`, `public/screen-gather.jsx`, `public/screen-outputs.jsx`, `public/screen-studio.jsx`, `src-tauri/src/main.rs`, and the installed-app/onboarding verifier scripts.

## Fix Applied

- Desk thread deletion is now a separate keyboard-focusable button instead of a clickable span nested inside the thread selector.
- Desk thread deletion now asks for confirmation before deleting a thread with messages.

Files changed:

- `public/screen-desk.jsx`

## Blockers

No P0 UX blockers found in the tested local-first desktop path.

The app boots from the installed DMG payload, initializes the local onboarding path, defaults to Ollama for clean desktop setup, and has passing first-run UI proof for typed and voice-style onboarding.

## Warnings

P1 - Microphone permission needs actual macOS denial coverage.

The copy is good when speech recognition fails: it tells the user to allow Pillar Press microphone access in macOS System Settings or keep typing. The browser-shell proof covers voice-style flow, but not the real macOS permission denial sheet and recovery loop inside a signed installed app. Add an installed-app test/manual checklist item for deny, retry, and continue typing.

P1 - Some destructive controls still need confirmation or undo.

Library piece deletion already confirms. Desk thread deletion is fixed in this audit. Remaining friction: Gather clear results, remove schedule/source, remove reference entries, and Studio/asset clear actions are quick single-click operations. For low-stakes transient items that may be acceptable, but anything deleting user-created workflows, source configuration, or generated media should confirm or offer undo.

P1 - Update/release UX is still external.

The app has strong packaging and release verification, but there is no in-app update prompt or "check for updates" flow visible in the desktop menus. For shared DMG releases this is acceptable for early distribution, but non-technical users will not know when a newer notarized build exists.

## Friction Points

- Onboarding is much clearer than earlier builds: it supports typed answers, voice-style answers, context-file analysis/regeneration, provider setup, and handoff to Desk. The next UX polish should make "what happens to my uploaded context files" explicit in one sentence near the analyze button.
- The AI/model setup panel now lists installed Ollama models, prefers Gemma-style models, shows suggested pulls, and lets OpenAI save into LLM plus media/voice defaults. Cloud model listing can still feel odd if a provider returns a huge or filtered list; keep the manual model input visible as the current escape hatch.
- Empty states are generally present and friendly in Library, Gather, Weave, Outputs, and Book. Studio model/media empty states should explicitly say whether the missing piece is "add a key", "test the key", or "generate media first".
- Loading states exist for onboarding, provider tests, Gather, output generation, and Studio. Long-running model pulls should ideally show a persistent note that this may take several minutes and can be left running.
- Error messages are mostly readable and credential-safe. Provider errors should continue to normalize raw upstream text so no key fragments, bearer headers, or long provider stack traces surface in the UI.
- App lifecycle is sane: packaged server reserves a local port, clears saved window state at startup, initializes local SQLite, and exposes reload, data folder, local backup, backup folder, and model setup menu actions. There is no visible recovery screen if the packaged server cannot start; startup logs exist, but the user-facing path should be clearer.

## Recommended Tests

- Installed app microphone permission matrix: allow, deny, deny then re-enable in System Settings, no microphone device, continue typing after failure.
- Keyboard-only Desk journey: create thread, switch thread, delete populated thread, cancel confirmation, send to Library.
- Onboarding context import: upload multiple mixed files, analyze, regenerate, edit fields manually, finish setup, verify preferences saved without storing raw secrets.
- Local-first offline path: launch with no network, no cloud keys, Ollama stopped, then start Ollama from Help and save a local model.
- Provider model selector: OpenAI, xAI, Anthropic, Gemini, Ollama, Docker Model Runner, and OpenAI-compatible endpoint with both successful listing and readable failure states.
- Gather destructive actions: remove source, remove schedule, clear results, dismiss research brief; verify confirmation or undo behavior once added.
- Backup/export safety: create local backup, inspect manifest, confirm settings secrets are nulled and generated files/database are present.
- Startup failure UX: simulate missing desktop-server resource or broken bundled Node and verify the user sees a clear recovery message plus log path.

## Suggested Copy Fixes

- Context-file analyzer: "Files are used locally to draft preferences for this setup. You can regenerate or edit every field before saving."
- Long Ollama pull: "This can take several minutes for large models. Keep Pillar Press open while Ollama downloads it."
- Startup failure screen: "Pillar Press could not start its local server. Open the data folder for logs, then relaunch or reinstall the app."
- Studio empty models: "No media models are ready yet. Add and test a media provider key, or choose OpenAI if you already saved it during setup."

## Recommendation

The current desktop app is ready for a production-candidate UX pass with warnings. Do not block a notarized internal or trusted-user release on the warnings above, but address the microphone-denial test and destructive-action confirmations before a broader non-technical audience release.
