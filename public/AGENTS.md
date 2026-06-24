# Instructions for Codex in `public/`

<!-- sphere-agents-standard:start -->

## Scope

This directory owns the static React frontend modules, onboarding runtime,
and vendored browser startup assets. Inherit the repository root `AGENTS.md`;
this file adds browser-runtime rules only.

## Required Boundaries

- Do not expose provider keys, OAuth secrets, tokens, or desktop settings
  secrets through browser globals, localStorage, bundled modules, screenshots,
  logs, or route responses.
- Keep startup browser assets local. React, ReactDOM, the compiled browser
  shell, and startup fonts must not require CDN access in the packaged desktop
  app.
- Preserve the conversational onboarding goal: clean, non-redundant setup that
  saves model/provider choices only through approved server/native paths.
- Browser state may mirror setup status for convenience, but durable desktop
  setup completion comes from native app-data settings.

## Verification

Use focused frontend checks when possible:

```bash
npm run typecheck
npm test
npm run onboarding:verify
npm run onboarding:verify:browser
npm run desktop:verify-release
```

For UI changes, verify in the desktop/webview path when the Human Request
requires installed-app behavior.

## Stop Conditions

Stop before adding new browser egress, new persistent browser storage of
credentials, CDN dependencies for startup, microphone permission changes, or
external-provider behavior not covered by the Human Request.

<!-- sphere-agents-standard:end -->
