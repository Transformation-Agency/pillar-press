# Release Workflows

Pillar Press has GitHub Actions workflows for desktop release artifacts:

- `.github/workflows/macos-release.yml` builds signed and notarized macOS DMGs
  for Apple Silicon and Intel.
- `.github/workflows/windows-build.yml` builds the Windows installer with Azure
  Trusted Signing.

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

## Release Flow

The release workflows run on:

- `workflow_dispatch`
- pushed tags matching `v*`

For a public release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

On a tag, the workflows upload these release assets:

- `Pillar.Press_<version>_aarch64.dmg`
- `Pillar.Press_<version>_aarch64.dmg.sha256`
- `Pillar.Press_<version>_x64.dmg`
- `Pillar.Press_<version>_x64.dmg.sha256`
- `Pillar.Press_<version>_x64-setup.exe`
- `Pillar.Press_<version>_x64-setup.exe.sha256`

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
