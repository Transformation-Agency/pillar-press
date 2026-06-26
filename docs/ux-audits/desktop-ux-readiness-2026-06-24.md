# Pillar Press Desktop UX Readiness Audit

Date: 2026-06-24
Scope: installed Pillar Press desktop app plus first-run, setup, settings, local data, model/provider, and recovery paths in code and tests.

## Verdict

Assessment: not production-ready without fixes, but close. The app boots, local data is visible, onboarding proofs pass, and the local-first model/provider flow is substantially safer than earlier builds. The remaining risks are mostly trust and recovery issues: users need clearer save state, clearer setup/editing context, better accessibility/focus handling for overlays, and stronger offline/error affordances.

## Evidence

- Ran installed app: `/Applications/Pillar Press.app`, bundle ID `com.pillar.press`.
- Observed live app at `127.0.0.1:53194`: Library opened with restored documents, current campaign switcher, simplified top nav, setup, backup, model settings, preferences, and theme controls.
- Opened conversational setup from the running app; tested skip path back to Library and Speak Answer transition to Listening.
- Opened Preferences from the running app and inspected editable preference sections.
- Ran `npm run onboarding:verify`: passed typed, voice, and provider-ready scenarios.
- Ran `npm run onboarding:verify:browser`: passed typed and voice browser-shell scenarios.
- Ran targeted tests: `npm test -- __tests__/onboarding.test.ts __tests__/audio-actions.test.ts __tests__/audio-actions-ui.test.ts __tests__/browser-library.test.ts __tests__/local-desktop.test.ts __tests__/desktop-native-settings.test.ts __tests__/provider-catalog-routes.test.ts __tests__/llm-provider-routes.test.ts`; 8 files, 94 tests passed.
- Inspected `public/app.jsx`, `public/setup-helper.jsx`, `public/onboarding-actions.js`, `public/onboarding-audio.js`, `public/store.js`, `public/screen-library.jsx`, `public/screen-references.jsx`, `src-tauri/src/main.rs`, `src-tauri/Info.plist`, and relevant tests.

## Blockers

1. Setup overlay is visually present but not represented correctly in the accessibility tree.
   - Live observation: after opening Setup, the visual setup canvas appeared, but the accessibility tree still exposed the underlying Library controls.
   - Why it matters: screen-reader users and keyboard automation may interact with hidden/underlying content while setup is on screen.
   - Concrete fix: render setup/model/billing/campaign dialogs with `role="dialog"`, `aria-modal="true"`, a labelled heading, initial focus moved into the dialog, Escape handling, focus trap, and mark the app shell inert/`aria-hidden` while modal setup is open.
   - Suggested copy: add a small heading/subhead for reopened setup: "Update setup" and "This will not erase your existing documents. Changes apply to the current focus unless you choose another one."

2. Preferences auto-save is too implicit for a local-first app users must trust.
   - Code evidence: `public/screen-references.jsx` commits textarea edits on blur and routes list edits immediately through `window.Store.setReferenceSection`; `public/store.js` uses background persistence with console-only failure handling.
   - Why it matters: users cannot tell whether a preference was saved, failed, or is still dirty. These preferences drive review/revision outputs, so silent save uncertainty damages trust.
   - Concrete fix: add a small persistent status near Preferences: "Saved locally", "Saving...", "Could not save. Retry", and track per-section dirty state. Keep blur-save, but make it visible.
   - Suggested copy: "Saved locally to this Mac." / "Saving changes..." / "Could not save. Your edit is still on screen. Retry."

3. Store hydration and background persistence can fail silently in the main UX.
   - Code evidence: `public/store.js` catches several hydration calls and logs warnings, and `bg()` only logs failed background saves.
   - Why it matters: non-happy paths such as local server restart, SQLite lock, failed media fetch, or offline provider calls can leave lists partially hydrated without a user-facing recovery path.
   - Concrete fix: introduce a global local-data health banner or toast fed by Store errors, with "Retry" and "Open local backup folder" actions where relevant.
   - Suggested copy: "Pillar Press could not refresh everything from local storage. Your local data was not deleted. Retry."

## High Friction

4. Reopened setup feels like first-run setup, not setup editing.
   - Live observation: using the topbar Setup button with existing campaigns/documents opens the same intro copy: "I can guide you through setup..." and "You can also skip setup..."
   - Why it matters: a returning user may worry they are resetting or overwriting existing preferences.
   - Concrete fix: pass an `editingExistingSetup` mode into `SetupHelper` when opened from the topbar after onboarding is complete. Change title/copy and show current provider/focus/preferences summary.
   - Suggested copy: "Update your setup" / "Your documents stay where they are. Use this to adjust models, voice, first focus, or preferences."

5. Microphone permission is recoverable but not sufficiently pre-explained.
   - Evidence: `src-tauri/Info.plist` has `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`; `public/onboarding-audio.js` maps permission failures to readable recovery text; live setup changed Speak Answer to Listening.
   - Why it matters: voice is optional, but users need to know before the OS prompt why macOS is asking and how to recover if denied.
   - Concrete fix: before calling `getUserMedia`, show a one-line inline preflight: "macOS will ask for microphone access next. Deny is okay; typing still works." If denied, include a button or menu item to open System Settings > Privacy & Security > Microphone if feasible.

6. Model setup is functionally strong but still dense for first-run users.
   - Evidence: `public/app.jsx` model setup supports Ollama, Docker Model Runner, Cloud API key, model listing, testing, save, task defaults, and saved key reuse.
   - Why it matters: the first screen has several modes, model input, pull/list/test/use buttons, and profile naming. Users can recover, but need a clearer sequence.
   - Concrete fix: visually number the sequence in-place: 1. Choose source, 2. Select or list model, 3. Test, 4. Use model. Keep the existing controls.
   - Suggested copy: "Test does not save. Use model saves this profile for all workflows."

7. Backup action succeeds, but backup affordance is too icon-only.
   - Live observation: topbar backup is a database icon with tooltip "Create local backup"; success uses a bottom toast with path.
   - Why it matters: backup is central to trust for local-first desktop. Icon-only makes it easy to miss.
   - Concrete fix: move backup into Preferences or a small "Local data" panel with "Create backup", "Open backups folder", latest backup timestamp, and redacted-settings note.

## Medium Friction

8. Destructive actions rely on browser confirm copy and do not explain recovery.
   - Evidence: piece delete and Desk thread delete use `confirm(... "This can't be undone.")`.
   - Concrete fix: replace with styled app confirm dialogs that include object name, consequence, and cancel focus default. For pieces, mention backups if available.

9. Empty states are useful but uneven.
   - Evidence: first campaign empty state is strong; Library empty state offers "Start a piece"; no-piece-open state points back to Library. Preferences sections with no entries mostly show only "Add".
   - Concrete fix: add one-line examples in empty preference sections, especially Audiences, Voice, Red Lines, and Gate Preferences.

10. Hosted auth copy exists in desktop bundle but should stay impossible to encounter in normal desktop.
   - Evidence: `HostedAuthScreen` is clear and recoverable, but desktop should remain local-first.
   - Concrete fix: add a desktop smoke test asserting installed/local-first mode never renders hosted auth configuration/sign-in screens without explicit hosted env.

11. Keyboard shortcut discoverability is minimal.
   - Evidence: topbar and menus expose buttons, but no in-app shortcut help was visible during the audit.
   - Concrete fix: add a Help menu item or Preferences section for shortcuts. Prioritize New Piece, Back to Library, Run Review, Save/Export, Open Setup, Open Model Settings.

12. Update prompts are not visible.
   - Evidence: no updater UX found in inspected desktop paths. This may be intentional for manual DMG releases.
   - Concrete fix: if updates are manual, add "Check for updates" linking to the public releases repo or a clear "Version 0.1.2" line in About/Preferences. If automatic updates are planned, add deferrable prompts with release notes and "not now".

## What Is Working

- Installed desktop app boots and serves the packaged local UI.
- Current documents are visible across focuses.
- Top navigation is simplified to Desk, Library, Preferences, with Weave/Studio under Library.
- Empty first-campaign state exists and points to New campaign.
- Onboarding deterministic tests cover typed, voice, provider-ready, repairs, fallback, and first-value activation.
- Voice permission error strings avoid raw browser/provider language.
- macOS microphone and speech-recognition usage descriptions are present.
- Model setup no longer defaults to stale Babbage-era models; visible defaults include current OpenAI and Gemma/Ollama options.
- OpenAI key save path seeds media/voice settings in desktop native settings.
- Local-first data and native provider settings are covered by tests.

## Recommended Tests

1. Accessibility/modal test for SetupHelper and DesktopOnboarding:
   - Open setup.
   - Assert `role="dialog"`/`aria-modal`.
   - Assert focus is inside setup.
   - Assert background nav/buttons are inert or hidden from accessibility tree.
   - Press Escape and assert expected close behavior.

2. First-run desktop smoke with isolated data dir:
   - Launch installed app or Tauri dev with `PILLAR_PRESS_DESKTOP_DATA_DIR` pointing to a temp directory.
   - Assert first-run setup appears.
   - Skip setup.
   - Create campaign.
   - Quit/reopen.
   - Assert campaign persists and setup does not force-repeat.

3. Preferences save-state test:
   - Edit a preference field.
   - Assert "Saving..." then "Saved locally".
   - Simulate `/api/campaigns/:id/references` failure.
   - Assert visible retry state and no text loss.

4. Offline/local-server interruption test:
   - Simulate failed fetch during Store hydration.
   - Assert a user-facing local-data warning appears.
   - Click Retry and assert recovery.

5. Microphone permission non-happy-path test:
   - Mock `getUserMedia` denied, not found, and already in use.
   - Assert preflight copy appears before request.
   - Assert recovery copy includes typing fallback and system-settings guidance.

6. Model setup journey test:
   - With Ollama installed but no matching model: shows pull guidance and disables Use Model.
   - With saved OpenAI/xAI key: List Models works without repasting key where supported.
   - With provider returning no models: user can type a model and Test shows readable failure.

7. Backup trust test:
   - Click Create local backup.
   - Assert success includes path and redacted-settings language.
   - Open backup folder if exposed.
   - Assert no provider key plaintext in backup.

8. Quit/restart test:
   - Start a draft edit and a preferences edit.
   - Quit app.
   - Reopen.
   - Assert saved edits persist or unsaved edits were explicitly warned before quit.

## Suggested Implementation Order

1. Fix modal accessibility/focus for setup/model/billing/campaign dialogs.
2. Add visible save/failed-save state to Preferences and Store background persistence.
3. Add a local-data health/retry banner for hydration failures.
4. Make reopened setup copy distinct from first-run setup.
5. Add microphone preflight copy and permission recovery affordance.
6. Add isolated-data first-run and quit/restart smoke tests.
