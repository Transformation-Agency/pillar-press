# Release Workflows

Pillar Press has GitHub Actions workflows for desktop release artifacts:

- `.github/workflows/macos-release.yml` builds signed and notarized macOS DMGs
  for Apple Silicon and Intel.
- `.github/workflows/windows-build.yml` builds the Windows installer with Azure
  Trusted Signing.
- `.github/workflows/publish-updater-manifest.yml` publishes the signed
  `latest.json` updater feed after all updater assets are present on the
  GitHub Release.

The first updater-enabled release must still be downloaded manually. Releases
after that can be installed from inside Pillar Press.

## macOS Secrets

Add these repository secrets before running the macOS workflow:

- `APPLE_CERTIFICATE_P12_BASE64`: base64 encoded Developer ID Application
  `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: password for the `.p12` certificate.
- `KEYCHAIN_PASSWORD`: temporary CI keychain password. Any strong random value
  is fine.
- `APPLE_SIGNING_IDENTITY`: exact Developer ID Application identity, for example
  `Developer ID Application: Your Company (TEAMID)`.
- `APPLE_ID`: Apple ID email used for notarization.
- `APPLE_PASSWORD`: app-specific password for that Apple ID.
- `APPLE_TEAM_ID`: Apple Developer Team ID.
- `TAURI_SIGNING_PRIVATE_KEY`: private Tauri updater signing key.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional password for the updater key,
  if the key was generated with one.

The updater private key is separate from the Apple signing certificate. Losing
the updater private key or its password means already-installed apps cannot
trust future update packages.

For this release track, a local backup copy of the updater key can be kept at
`~/.tauri/pillar-press-updater.key`. Do not commit it.

Create the base64 certificate value locally:

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

## Windows Secrets

Add these repository secrets before running the Windows workflow:

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_ENDPOINT`
- `AZURE_CODE_SIGNING_NAME`
- `AZURE_CERT_PROFILE_NAME`

The Windows workflow signs with Azure Trusted Signing and produces an NSIS
installer.

Windows also needs:

- `TAURI_SIGNING_PRIVATE_KEY`: same updater signing key used by macOS.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional password for the updater key,
  if the key was generated with one.

## Feedback Configuration

The in-app feedback widget submits to the shared Transformation Agency feedback
server. Add this optional repository variable for release builds:

- `VITE_PILLAR_PRESS_FEEDBACK_API_BASE`: defaults to
  `https://project-cw1bz.vercel.app` when unset.

The feedback server must also have an enabled app configuration:

- App id / product: `pillar-press`
- GitHub owner: `Transformation-Agency`
- GitHub repo: `pillar-press`

If the server enforces allowed origins, include the packaged desktop origins and
any local development origins used for smoke testing.

## Release Flow

The release workflows run on:

- `workflow_dispatch`
- pushed tags matching `v*`

For a public release:

```bash
git tag v0.2.1
git push origin v0.2.1
```

On a tag, the workflows upload these release assets:

- `Pillar.Press_<version>_aarch64.dmg`
- `Pillar.Press_<version>_aarch64.dmg.sha256`
- `Pillar.Press_<version>_x64.dmg`
- `Pillar.Press_<version>_x64.dmg.sha256`
- `Pillar.Press_<version>_x64-setup.exe`
- `Pillar.Press_<version>_x64-setup.exe.sha256`
- `Pillar.Press_<version>_aarch64.app.tar.gz`
- `Pillar.Press_<version>_aarch64.app.tar.gz.sig`
- `Pillar.Press_<version>_x64.app.tar.gz`
- `Pillar.Press_<version>_x64.app.tar.gz.sig`
- `Pillar.Press_<version>_x64-setup.exe.sig`
- `latest.json`

The app reads update metadata from:

```text
https://github.com/Transformation-Agency/pillar-press/releases/latest/download/latest.json
```

`latest.json` is generated only for stable tag releases. It contains platform
entries for `darwin-aarch64`, `darwin-x86_64`, and `windows-x86_64`, with HTTPS
asset URLs and inline signatures.

## macOS Notes

Both macOS targets build on Apple Silicon GitHub runners. The Intel job
downloads the matching `darwin-x64` Node runtime and exposes it as
`PILLAR_PRESS_NODE_SIDECAR_PATH` so the x64 app bundle ships an x64 Node sidecar.

Each macOS job builds a static `whisper-cli` for its target architecture and
uses the checked-in tiny English model.

## Local Equivalent

The macOS CI workflow is roughly equivalent to:

```bash
npm ci
npm run desktop:build -- --target aarch64-apple-darwin --config src-tauri/tauri.ci.conf.json
xcrun notarytool submit <dmg> --wait
xcrun stapler staple <dmg>
```

The workflow writes temporary Tauri signing config files at runtime from
secrets, so signing identity details do not need to live in the repository.
