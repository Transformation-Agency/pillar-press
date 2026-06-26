# Instructions for Codex in `lib/llm/`

<!-- sphere-agents-standard:start -->

## Scope

This directory owns provider-neutral LLM access. Inherit the repository root
`AGENTS.md`; this file adds LLM-provider rules only.

## Required Boundaries

- Keep model access provider-neutral. Feature code should not call OpenAI,
  Anthropic, Gemini, xAI/Grok, Ollama, Docker Model Runner, or OpenAI-compatible
  endpoints directly.
- Keep secrets server-side or native-side. Do not return raw keys from routes,
  write keys to browser-visible state, log credentials, or include credentials
  in fixtures, docs, backups, or audit reports.
- Preserve readable provider errors while redacting credentials and sensitive
  headers.
- Keep local-first providers first-class. Ollama and Docker Model Runner must
  remain usable without hosted auth or cloud keys.
- Do not change editorial prompt contracts from this layer unless the Human
  Request explicitly asks for product behavior changes.

## Verification

Use the narrowest relevant checks, commonly:

```bash
npm run typecheck
npm test
npm run desktop:verify-live-providers
```

Only run live-provider checks when the Human Request permits use of configured
keys or local providers. Record provider, model, command, and result without
leaking credentials.

## Stop Conditions

Stop before adding a new provider, new egress path, new key storage location,
new browser-visible setting, or changed privacy/transmission policy unless it is
inside the Human Request.

<!-- sphere-agents-standard:end -->
