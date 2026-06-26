# Production Readiness

Pillar Press is a local-first desktop product. Production
readiness means a packaged app can boot its local Next server, initialize SQLite,
serve packaged browser assets, and complete first-run setup without hosted auth,
Postgres, Docker, Vercel, or cloud model keys.

## Required Gates

Run these before a local QA release:

```bash
npm audit --audit-level=moderate
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
npm run desktop:release-readiness
npm run onboarding:verify
npm run onboarding:verify:browser
npm run desktop:build
npm run desktop:verify-release
npm run desktop:verify-installed
```

The GitHub Actions desktop CI workflow runs the non-interactive subset on macOS:
npm audit, typecheck, Vitest, desktop server resource preparation, Rust tests,
release-readiness, onboarding verification, desktop build, and desktop release
verification.

Developer ID signing and Apple notarization remain a credentialed local/release
operator step:

```bash
npm run desktop:build:signed
npm run desktop:verify-signed-release
```

## Local File Access

Generated local media and exports are served through `/api/local-files/...` only
after the request resolves an authenticated local user and the runtime is in
local-first mode. Hosted mode returns a 404 for that route. Path traversal is
still rejected against the resolved local storage root.

## Desktop Webview Boundary

The Tauri webview is limited to the packaged app origin and the launcher-owned
`127.0.0.1` server. The default capability no longer grants `localhost:*`
because that name can resolve outside the exact loopback address the launcher
owns.

The browser shell precompiles the static JSX modules into
`public/build/app.compiled.js`, so the Tauri CSP no longer allows `unsafe-eval`.
The CSP is no longer disabled: it restricts default resources to self,
network/API/media access to `https:` and `127.0.0.1`, blocks objects, and blocks
framing. Inline styles remain allowed because the React UI uses inline style
objects.

## Dependency Audits

The npm lockfile is expected to pass:

```bash
npm audit --audit-level=moderate
```

`undici` is pinned through npm overrides so transitive consumers use a patched
version. Keep future audit fixes in `package.json`/`package-lock.json`; do not
patch installed `node_modules` by hand.

## Update Posture

Public release DMGs are currently manual downloads. The app does not ship an
auto-updater feed yet, so production updates should be published as fresh DMGs
with matching release notes and hashes. If an automatic updater is added later,
it must use a signed update feed and must not require hosted auth for normal
desktop use.

## Dual Architecture Releases

Apple silicon and Intel DMGs must be built with architecture-matched Node
runtimes and native modules. For Intel builds from Apple silicon, prepare x64
Node and x64 native dependencies, then build with the x86_64 target:

```bash
rustup target add x86_64-apple-darwin
PILLAR_PRESS_NATIVE_TARGET_ARCH=x64 \
PILLAR_PRESS_NATIVE_DEPS_PATH=/tmp/pillar-press-x64-deps \
PILLAR_PRESS_NODE_RUNTIME_PATH=/tmp/pillar-press-x64-node/bin/node \
PILLAR_PRESS_NODE_RUNTIME_ARCH=x64 \
PILLAR_TARGET_TRIPLE=x86_64-apple-darwin \
npm run desktop:build -- --target x86_64-apple-darwin
```

Signed dual-architecture releases should verify each DMG with
`npm run desktop:verify-signed-release`, `spctl --assess --type execute` for the
app, and `spctl --assess --type install` for the DMG.
