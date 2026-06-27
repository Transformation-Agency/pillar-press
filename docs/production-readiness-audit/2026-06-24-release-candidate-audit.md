# Pillar Press Production Readiness Audit

Date: 2026-06-24
Branch: `codex/fix-pillar-press-port-isolation`
Audit mode: multi-pass agentic workflow, local only
Target: production-ready desktop release candidate

## Planner Pass

### Scope

Audit and harden Pillar Press as a local-first Tauri desktop app
with a packaged Next.js server, SQLite desktop storage, local app-data files,
provider-neutral LLM settings, optional hosted providers, and macOS installer
artifacts.

### Primary Evidence Sources

- `AGENTS.md`
- `docs/PRODUCTION_READINESS.md`
- `docs/DESKTOP_LOCAL_FIRST.md`
- `docs/LOCAL_DEV.md`
- `docs/BUILD_BRIEF.md`
- `.github/workflows/desktop-ci.yml`
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/permissions/desktop-setup.toml`
- source and test results from the current worktree

### Production-Critical Surfaces

| ID | Surface | Severity if broken | Evidence method | Status |
| --- | --- | --- | --- | --- |
| RC-01 | Local-first desktop boot without hosted auth/Postgres | P0 | `desktop:build`, `desktop:verify-release`, `desktop:verify-installed` | Pass |
| RC-02 | SQLite/local storage and `/api/local-files` containment | P0 | tests, verifier, source review | Pass |
| RC-03 | Secrets stay server/native-side and backups redact keys | P0 | tests/source review/verifier | Pass |
| RC-04 | LLM provider setup and provider-neutral `lib/llm` path | P1 | tests/source review/provider verifiers if authorized | Pass with warning |
| RC-05 | Tauri CSP/capabilities constrained to owned local runtime | P1 | config review, verifier | Pass |
| RC-06 | Onboarding/setup usable in desktop/browser shell | P1 | `onboarding:verify`, `onboarding:verify:browser`, installed verifier | Pass |
| RC-07 | Packaged server, bundled Node runtime, native modules | P1 | `desktop:build`, `desktop:verify-release` | Pass |
| RC-08 | Release readiness tracker has no unwaived blockers | P1 | `desktop:release-readiness` | Pass |
| RC-09 | Dependency audit/typecheck/unit/native tests | P1 | `npm audit`, `typecheck`, `npm test`, `cargo test` | Pass |
| RC-10 | macOS signing/notarization posture | P2 | config/script review; no external notarization without exact approval | Warning |
| RC-11 | Manual-update/release artifact posture | P2 | docs/config review | Warning |
| RC-12 | Instruction/governance hygiene after AGENTS migration | P2 | marker/hash validation, status review | Pass with warning |

### Severity Definitions

- P0: release-blocking safety, data, boot, or credential issue.
- P1: release-blocking functional or packaging issue for a normal desktop user.
- P2: release warning or operator-process risk.
- P3: cleanup, documentation, or polish that should not block a release.

### Assumptions And Unknowns

- This audit is local. It does not deploy, push, release, notarize, or mutate
  GitHub.
- Live hosted provider keys are not assumed available unless explicitly
  authorized in this session.
- Existing untracked release artifacts are not treated as source of truth.
- Signed/notarized release creation is out of scope unless separately requested.

## Implementer Pass

### Commands Run

| Command | Result | Evidence |
| --- | --- | --- |
| `npm audit --audit-level=moderate` | Pass | `found 0 vulnerabilities` |
| `npm run typecheck` | Pass | `tsc --noEmit`, exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass | 2 Rust tests passed |
| `npm test` | Pass | 85 test files, 520 tests passed |
| `npm run build` | Pass | Next.js 15.5.19 production build completed; 48 static pages generated |
| `npm run desktop:release-readiness` | Pass | 71 stories: 67 retest passed, 3 hosted out of local-first scope, 1 waived; no unwaived blockers |
| `npm run onboarding:verify` | Pass | typed, voice, and provider-ready setup scenarios passed |
| `npm run onboarding:verify:browser` | Initially failed | Puppeteer could not find Chrome `149.0.7827.22` in `the local Puppeteer cache` |
| `npm run desktop:build` | Pass | Built `.app` and `Pillar Press_0.2.0_aarch64.dmg` |
| `npm run desktop:verify-release` | Pass | App bundle, DMG, packaged server, bundled Node, no env files, local browser runtimes, codesign, DMG mount, and packaged server smoke passed |
| `npm run desktop:verify-installed` | Pass | DMG mounted, copied app launched, local server started, onboarding completed |
| `npm test` after fix | Pass | 85 test files, 520 tests passed |

### Confirmed Issue And Fix

#### P1: Browser-based release verifiers depended only on Puppeteer's managed Chrome

`npm run onboarding:verify:browser` failed because Puppeteer could not find the
managed Chrome version in `the local Puppeteer cache`, even though system
Chrome was installed at `/Applications/Google Chrome.app`.

Fix applied:

- Added `scripts/puppeteer-launch.ts`.
- The helper honors `PUPPETEER_EXECUTABLE_PATH` first.
- On macOS it falls back to common installed browsers:
  - Google Chrome
  - Chromium
  - Microsoft Edge
  - Brave Browser
- If no local browser is found, it leaves Puppeteer's default managed-browser
  behavior intact.
- Updated:
  - `scripts/verify-onboarding-browser-shell.ts`
  - `scripts/verify-installed-app.ts`

This is a release-hardening change only; no production dependency was added.

### Built Artifact

Fresh local QA artifact:

```text
src-tauri/target/release/bundle/dmg/Pillar Press_0.2.0_aarch64.dmg
SHA-256: 28ce908b58eafc4dc6fb38c40253fd93609248e778e9b61c343f78610566bdcf
```

## Verifier Pass

### Independent Review

Reviewed the script diff after the fix:

- `scripts/verify-onboarding-browser-shell.ts` now delegates browser launch to
  `launchProofBrowser()`.
- `scripts/verify-installed-app.ts` now delegates browser launch to the same
  helper.
- `scripts/puppeteer-launch.ts` is small, local, deterministic, and does not add
  dependencies or alter app runtime behavior.

Reran relevant checks after the fix:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run onboarding:verify:browser` | Pass; typed and voice browser shell scenarios completed |
| `npm run desktop:verify-release` | Pass |
| `npm run desktop:verify-installed` | Pass |
| `npm test` | Pass; 85 files / 520 tests |

Validated instruction/governance hygiene:

- Constitution copy hash matches `constitution/CONSTITUTION.lock`.
- All active `AGENTS.md` files contain managed-section markers.
- Root `AGENTS.md` accidental patch sentinel was removed during this audit.

## Release Auditor Pass

### Checklist Result

| ID | Status | Notes |
| --- | --- | --- |
| RC-01 | Pass | `desktop:build`, `desktop:verify-release`, and `desktop:verify-installed` passed. |
| RC-02 | Pass | Covered by test suite and release verifier local-file/storage checks. |
| RC-03 | Pass | Rust backup redaction tests passed; release verifier confirmed no bundled env files. |
| RC-04 | Pass with warning | Provider-neutral path covered by tests and status/verifier evidence; live hosted provider calls were not run in this local audit. |
| RC-05 | Pass | Tauri config/capability review shows app constrained to `127.0.0.1:*` with a native navigation guard; CSP removes `unsafe-eval`, and global Tauri exposure is disabled. |
| RC-06 | Pass | Onboarding activation proof, browser shell proof, and installed-app onboarding smoke passed. |
| RC-07 | Pass | Desktop build and verifier confirmed packaged server, bundled Node runtime, native resources, and DMG payload. |
| RC-08 | Pass | Release readiness tracker has no unwaived blockers. |
| RC-09 | Pass | npm audit, typecheck, Vitest, Next build, and Rust tests passed. |
| RC-10 | Warning | Local QA DMG is ad-hoc signed and not notarized. Signed/notarized build was not run because it performs credentialed external Apple notary work and was not explicitly requested for this audit turn. |
| RC-11 | Warning | Manual update posture is documented. No auto-updater exists yet. |
| RC-12 | Pass with warning | Instruction files validate locally, but several are untracked until a human decides whether to commit them. |

### Remaining Risks And Unknowns

- P2: Signed/notarized public distribution was not performed in this audit. Run
  `npm run desktop:build:signed` and `npm run desktop:verify-signed-release`
  only after exact human approval and signing credential confirmation.
- P2: Live hosted provider checks were not run. This audit proves local gates
  and packaged behavior, not live cloud-provider billing or availability.
- P2: The static browser shell now precompiles JSX, the Tauri CSP no longer
  allows `unsafe-eval`, and global Tauri exposure is disabled. Residual webview
  risk remains because the main webview still owns setup/settings/backup IPC
  permissions and style `unsafe-inline` remains for React inline styles.
- P2: The worktree has untracked instruction/audit/constitution files and
  unrelated pre-existing untracked release artifacts. They must be reviewed
  before a clean release commit.

### Final Assessment

**RELEASE READY WITH WARNINGS** for a local QA release candidate.

The local desktop build, packaged server, bundled runtime, onboarding flows,
SQLite/local-first posture, release-readiness tracker, dependency audit,
typecheck, unit tests, Rust tests, browser-shell proof, and installed-DMG smoke
all pass after the verifier-script hardening fix.

It is not yet a public distribution-ready release solely from this audit because
signed/notarized dual-architecture release work was intentionally not run in
this local pass.

### Next Actions

1. Human review the untracked instruction/audit/constitution files and decide
   what should be committed.
2. Commit the verifier fallback fix if accepted.
3. For public distribution, run the signed/notarized build flow with explicit
   signing identity approval, then verify both Apple silicon and Intel DMGs.
4. Consider splitting the desktop setup IPC permission into narrower setup,
   backup, speech, and provider-settings capabilities.
