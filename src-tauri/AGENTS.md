# Instructions for Codex in `src-tauri/`

<!-- sphere-agents-standard:start -->

## Scope

This directory owns the Tauri desktop shell, native commands, macOS permissions,
bundled resource lookup, signing metadata, icons, and release bundle behavior.
Inherit the repository root `AGENTS.md`; this file adds native-desktop rules
only.

## Permitted Activities

- Modify Tauri Rust code, capability files, permissions, icons, and Tauri config
  when the Human Request covers desktop behavior.
- Preserve the packaged Next server and bundled Node runtime lookup contract.
- Keep local-first startup behavior intact: private localhost server, SQLite app
  data, local storage, and no required hosted auth.
- Run local verification commands that are already evidenced by the repo.

## Commands

Supported commands from repository manifests and docs:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build
npm run desktop:verify-release
npm run desktop:verify-installed
npm run desktop:build:signed
npm run desktop:verify-signed-release
```

Run signed/notarized commands only when the Human Request explicitly authorizes
signing/notarization/release work. Do not expose Apple credentials or
app-specific passwords in files, logs, commits, or reports.

## Protected Paths And Stop Conditions

- Do not modify `src-tauri/target/` artifacts as source.
- Do not change bundle identifier, app-data identity, signing entitlements, or
  release channel without exact human approval.
- Stop before changing Tauri permissions/capabilities in a way that expands
  filesystem, shell, network, microphone, or external-open authority unless the
  Human Request explicitly covers that expansion.
- Stop if packaged app behavior diverges from local-first desktop mode or if a
  change would require Supabase/Postgres/cloud keys for normal desktop use.

## Evidence

For native changes, report:

- files changed;
- exact build or verifier command and exit code;
- app/DMG paths when built;
- signing/notarization status only when that work was explicitly requested;
- limitations such as not launching the packaged app or not running Gatekeeper.

<!-- sphere-agents-standard:end -->

