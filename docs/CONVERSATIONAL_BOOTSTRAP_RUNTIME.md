# Conversational Bootstrap Runtime

This document defines the production direction for KingPress first-run onboarding after the
`v0.1.0-onboarding.20260610-0159` release candidate.

The goal is not a richer setup wizard. The goal is a reusable conversational bootstrap layer:
one shared runtime that opens as soon as the app is interactive, uses voice and text parity,
collects only essential setup, reaches a first usable workspace, and then hands off to the live
assistant once provider settings and app configuration are ready.

## Product Thesis

KingPress onboarding should be the user's first real conversation with the product.

The first-run experience should:

- Start on a quiet conversation canvas, not a tutorial carousel.
- Show every spoken line as text.
- Let every user answer by typing, voice, or explicit buttons.
- Ask one question at a time.
- Request permissions only after explaining the value of that capability.
- Preserve progress when speech, provider setup, or permissions fail.
- Configure enough of the app that the user can immediately do real work.
- Continue as the same assistant surface after setup.

The first value event is strict: a first focus/workspace/project exists and essential preferences
were saved. Skipping setup may complete onboarding, but it must not count as activation.

## Universal Runtime Versus App Manifest

The runtime is shared across KingPress apps. The manifest is app-specific.

Universal runtime responsibilities:

- Conversation state machine.
- Turn-taking rules.
- Intent normalization.
- Voice/text parity.
- Permission choreography.
- Action execution and action timeline.
- Progress preservation.
- Local-first persistence hooks.
- Analytics and success metrics.
- Accessibility, mute, reduced-motion, and fallback behavior.
- Handoff from deterministic bootstrap to live assistant mode.

Per-app manifest responsibilities:

- Product persona and tone boundaries.
- Bootstrap graph nodes.
- Required setup tasks.
- Optional setup tasks.
- Activation definition.
- App-specific action bindings.
- App-specific provider defaults.
- First successful command or first useful object.

For King's Press, the current implementation maps to these files:

- Runtime shell: `public/onboarding-runtime.js`
- Conversation controller: `public/onboarding-conversation.js`
- Action registry: `public/onboarding-actions.js`
- Audio helpers: `public/onboarding-audio.js`
- Profile extraction helpers: `public/onboarding-profile.js`
- UI surface: `public/setup-helper.jsx`
- LLM extraction endpoint: `app/api/onboarding/extract-setup-profile/route.ts`

## Experience Principles

### Turn Taking

- One clear question per turn.
- The prompt must say what the user can do next.
- Every step supports `yes`, `no`, `later`, `skip`, `repeat`, `help`, typed answer, spoken answer,
  and correction.
- If the answer is unclear, the assistant offers likely repair choices instead of failing.

### Voice And Text Parity

- Spoken and display prompts must carry the same meaning.
- Display prompts are shorter than spoken prompts.
- Audio is never required to understand or complete setup.
- Captions/transcripts remain visible when speech is used.
- Voice can be muted or skipped at every voice-dependent step.

### Permissions

- Value first, permission second.
- Microphone is requested only after the user chooses voice setup.
- Memory, web research, external services, publishing, sending, and provider connections remain
  approval-gated.
- Denial or failure degrades to typing and local setup.

### Error Recovery

- Preserve prior answers.
- Repeat what was understood.
- Offer concrete repair choices.
- Keep moving when a nonessential provider, plugin, or permission is unavailable.
- Never leak raw provider credentials or raw provider bodies.

### Motion And Sensory Feedback

- Motion communicates state: idle, listening, thinking, acting, done, error.
- Use subtle bubble transitions and lightweight progress, not scene-heavy animation.
- Respect reduced motion.
- Haptics, when available, are reserved for meaningful moments: listening started, permission
  granted, provider connected, step completed.

## Runtime Architecture

The production architecture is a hybrid:

1. Deterministic bootstrap.
2. Dynamic assistant handoff.

### Stage 1: Launch Transition

The system splash remains only a launch affordance. The actual onboarding begins after the app
is interactive.

Production target:

- Short branded launch moment.
- No permission request on splash.
- No tutorial carousel.
- Transition directly into conversation canvas.

### Stage 2: Deterministic Bootstrap Graph

This phase works before any LLM provider is configured.

It may use:

- App-owned copy.
- Local intent classification.
- Local STT if available.
- Browser/desktop speech synthesis fallback.
- Pre-rendered or bundled audio cues later.

It must not use open-ended LLM reasoning to decide privileged setup flow.

Canonical intent buckets:

- `affirm`
- `deny`
- `skip`
- `later`
- `help`
- `repeat`
- `correction`
- `typed_answer`
- `spoken_answer`
- `provider_key`
- `permission_granted`
- `permission_denied`
- `unclear`

### Stage 3: Provider And Feature Enablement

This phase connects enough capability to finish setup and support ongoing work.

For King's Press this means:

- Optional voice.
- LLM provider or local model.
- Optional integrations.
- First focus/campaign.
- Preferences saved into references.

Provider keys entered during setup must be encrypted through the desktop settings bridge and must
not remain in browser local storage.

### Stage 4: Live Assistant Handoff

Once the configured provider is usable, the same thread becomes the live assistant surface.

The handoff should include:

- The setup transcript.
- The approved profile/preferences.
- The first focus.
- Provider capabilities.
- Clear boundaries around memory, web use, publishing, sending, and outside services.

Current King's Press implementation persists this handoff as `onboardingAssistantHandoffV1` and
seeds a durable Desk thread from the setup transcript. The seeded thread is marked
`source: "kings_press_setup"`, becomes the active Desk thread, and records a
`live_assistant_handoff` metric so activation can be correlated to the continuing assistant
surface. Desk chat calls now pass the active campaign id to `/api/desk/chat`; the route verifies
campaign scope, loads the approved references/setup profile, serializes them through
`buildRefContext`, and injects that context into the server-side assistant prompt.

## Manifest Schema

The runtime should consume a declarative manifest rather than hard-code setup steps inside UI.

```ts
type BootstrapManifest = {
  id: string;
  appName: string;
  version: string;
  persona: {
    role: string;
    tone: string[];
    boundaries: string[];
  };
  activation: {
    eventId: string;
    requiredSignals: string[];
    description: string;
  };
  capabilities: {
    voiceInput: "optional" | "required" | "disabled";
    voiceOutput: "optional" | "required" | "disabled";
    localStt: "optional" | "required" | "disabled";
    llmProvider: "optional" | "required" | "managed";
  };
  graph: BootstrapNode[];
};

type BootstrapNode = {
  id: string;
  goal: string;
  spokenPrompt: string;
  displayPrompt: string;
  expectedIntents: string[];
  validation: {
    required: boolean;
    minLength?: number;
    schema?: string;
  };
  sideEffects: string[];
  permissionDependency?: string;
  successTransition: string;
  skipTransition?: string;
  abortTransition?: string;
  repair: {
    unclear: string;
    invalid: string;
    providerFailure?: string;
    permissionDenied?: string;
  };
};
```

## King's Press Manifest V1

```json
{
  "id": "kings_press_editorial_desk",
  "appName": "King's Press",
  "version": "2026-06-10.bootstrap.v1",
  "persona": {
    "role": "warm editorial setup host",
    "tone": ["plainspoken", "calm", "useful", "editorial"],
    "boundaries": [
      "Do not imply King's Press replaces the writer.",
      "Do not infer permission to use memory, web research, publishing, sending, or external services.",
      "Ask before connecting outside providers."
    ]
  },
  "activation": {
    "eventId": "first_usable_setup",
    "requiredSignals": ["focus_ready", "preferences_saved"],
    "description": "A first focus exists and essential context defaults were saved."
  },
  "capabilities": {
    "voiceInput": "optional",
    "voiceOutput": "optional",
    "localStt": "optional",
    "llmProvider": "optional"
  },
  "graph": [
    {
      "id": "intro",
      "goal": "Orient the user and ask whether they want guided setup.",
      "spokenPrompt": "I'm King's Press. I help you articulate your thoughts and turn them into clear, publishable work. Would you like a guided intro, or would you rather skip setup for now?",
      "displayPrompt": "I'm King's Press. Would you like a guided intro?",
      "expectedIntents": ["affirm", "deny", "skip", "help", "repeat"],
      "validation": { "required": false },
      "sideEffects": ["record_intro_consent"],
      "successTransition": "voice",
      "skipTransition": "done_skipped",
      "abortTransition": "done_skipped",
      "repair": {
        "unclear": "I can guide you through setup, or you can skip and go straight to the desk.",
        "invalid": "Choose guided setup or skip setup."
      }
    },
    {
      "id": "voice",
      "goal": "Offer voice input/output without blocking setup.",
      "spokenPrompt": "If you want me to read and listen during setup, we can connect voice now. You can also keep typing.",
      "displayPrompt": "Add voice if you want audio replies.",
      "expectedIntents": ["provider_key", "permission_granted", "permission_denied", "skip", "help", "later"],
      "validation": { "required": false },
      "sideEffects": ["save_encrypted_voice_key", "request_microphone_if_selected", "record_voice_decision"],
      "permissionDependency": "microphone",
      "successTransition": "connect",
      "skipTransition": "connect",
      "abortTransition": "connect",
      "repair": {
        "unclear": "Voice is optional. You can connect it now or keep typing.",
        "invalid": "Use a provider key, connect the microphone, or skip voice.",
        "permissionDenied": "No problem. We'll keep setup in text."
      }
    },
    {
      "id": "connect",
      "goal": "Connect a model and optional integrations.",
      "spokenPrompt": "Now choose the model King's Press can use. Local models are welcome, and cloud keys are optional.",
      "displayPrompt": "Choose models and optional integrations.",
      "expectedIntents": ["provider_key", "local_model", "skip", "help", "later"],
      "validation": { "required": false },
      "sideEffects": ["save_encrypted_llm_settings", "test_provider", "record_provider_status"],
      "successTransition": "focus",
      "skipTransition": "focus",
      "abortTransition": "focus",
      "repair": {
        "unclear": "You can choose a local model, paste a cloud key, or skip this for later.",
        "invalid": "The provider did not respond. Check the key, model, or base URL."
      }
    },
    {
      "id": "focus",
      "goal": "Create or select the first focus.",
      "spokenPrompt": "What are you working on first? A project, campaign, launch, book draft, or something else is fine.",
      "displayPrompt": "What are you working on first?",
      "expectedIntents": ["typed_answer", "spoken_answer", "skip", "help", "repeat", "correction"],
      "validation": { "required": true, "minLength": 1 },
      "sideEffects": ["create_or_reuse_campaign", "record_focus_ready"],
      "successTransition": "preferences",
      "skipTransition": "preferences",
      "abortTransition": "done_skipped",
      "repair": {
        "unclear": "Give it a simple name. You can rename it later.",
        "invalid": "Use a short project or campaign name."
      }
    },
    {
      "id": "preferences",
      "goal": "Capture essential voice and audience defaults and save them to references.",
      "spokenPrompt": "Tell me how this desk should sound for you. Who are you writing for, and how polished should drafts be?",
      "displayPrompt": "Tell me how this desk should sound for you.",
      "expectedIntents": ["typed_answer", "spoken_answer", "skip", "help", "repeat", "correction"],
      "validation": { "required": true, "schema": "SetupProfile" },
      "sideEffects": ["extract_setup_profile", "show_review", "save_references", "record_preferences_saved"],
      "successTransition": "done_activated",
      "skipTransition": "done_not_activated",
      "abortTransition": "done_not_activated",
      "repair": {
        "unclear": "You can describe your voice in plain language. I will show what I understood before saving.",
        "invalid": "I could not turn that into setup defaults yet. Keep the text and edit the fields below."
      }
    }
  ]
}
```

## Analytics Model

Release-quality telemetry stays local unless the user explicitly opts into sharing.

Required events:

- `onboarding_started`
- `step_viewed`
- `answer_captured`
- `answer_repaired`
- `permission_prompted`
- `permission_granted`
- `permission_denied`
- `provider_test_started`
- `provider_test_succeeded`
- `provider_test_failed`
- `first_focus_created`
- `preferences_saved`
- `first_value_completed`
- `onboarding_completed`
- `onboarding_skipped`
- `sentiment_submitted`
- `sentiment_dismissed`
- `live_assistant_handoff`

Required summary metrics:

- Completion rate.
- Activation rate.
- Median setup duration.
- Conversational answer success rate.
- Voice-to-text fallback rate.
- Permission denial rate by step.
- Provider setup failure rate by provider type.
- Sentiment average.

Current implementation already persists:

- `onboardingMetricsEventsV1`
- `onboardingMetricsSummaryV1`
- `onboardingFirstValueEventV1`
- `onboardingSentimentV1`
- `onboardingAssistantHandoffV1`

Current implementation records `answer_repaired` and `fallback_used` locally. These events are
redacted, folded into `onboardingMetricsSummaryV1`, and are emitted when deterministic repair
choices are shown, speech falls back to typing, audio setup fails, or profile extraction falls
back to local interpretation. Sentiment already records through the onboarding metric stream.

## Engineering Slices

### Slice 1: Manifest Extraction

Move hard-coded graph data out of `public/onboarding-runtime.js` and
`public/onboarding-conversation.js` into a manifest module.

Deliverables:

- `public/onboarding-manifest.js`
- Runtime validation for required manifest fields.
- Tests proving the King's Press manifest produces the same current steps.

### Slice 2: Conversation Canvas

Replace the current setup-stage framing with a continuous conversation surface while preserving
the warm visual style already shipped.

Deliverables:

- Assistant/user bubbles for every turn.
- Spoken/display prompt parity.
- Compact inline controls per node.
- Old turns scroll upward with progress preserved.
- No tutorial cards.

Status: implemented for the setup helper surface. The visible stepper has been removed, prior
answers render as user bubbles, each setup node keeps its controls inside the same conversation
canvas, and skipped bookkeeping statuses are hidden from the user-facing transcript.

### Slice 3: Intent Repair

Add deterministic intent normalization and repair.

Deliverables:

- `affirm`, `deny`, `skip`, `later`, `help`, `repeat`, `correction`, `unclear`.
- `answer_repaired` metric.
- One-click repair options for unclear answers.
- Tests for varied utterances.

### Slice 4: Provider-To-Agent Handoff

When provider setup succeeds, hand off from deterministic bootstrap to the real assistant thread.

Deliverables:

- Setup transcript persisted as a Desk thread.
- Approved profile injected into assistant context.
- First post-setup assistant prompt.
- `live_assistant_handoff` metric.

Status: implemented for the Desk surface. The transcript seeds a durable Desk thread, the handoff
metric is recorded, and `/api/desk/chat` injects the active campaign's approved references/profile
into the live assistant context. Future app manifests can repeat this pattern for their own
post-setup assistant surfaces.

### Slice 5: Voice Runtime Upgrade

Keep voice optional and small in the base app. Add local STT as an optional install/provider later.

Deliverables:

- Local STT provider interface.
- Cloud STT/TTS provider interface.
- Speech disclosure copy.
- Mute/stop controls.
- Reduced-motion and no-audio fallback tests.

## Release Gates

A production release candidate must pass:

- A clean install starts onboarding immediately.
- User can skip setup and enter the app without activation being counted.
- User can answer required setup questions by typing.
- User can answer required setup questions by voice where supported.
- User can complete setup in under five minutes in the happy path.
- First value is counted only when a first focus exists and preferences are saved.
- Provider keys are encrypted and never stored in browser local storage.
- Denied microphone permission falls back to typing.
- All long-running actions show a busy state.
- Sentiment prompt appears after setup and records against the setup session.
- `npm run onboarding:verify`
- `npm run typecheck`
- `npm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run desktop:build:signed`
- `npm run desktop:verify-signed-release`

## Immediate Next Recommendation

Do not redesign the just-released onboarding again before production feedback.

The next build should focus on end-to-end desktop proof: clean install, first-run setup, provider
or intentional deferral, first focus, preferences saved, Desk handoff, and signed release checks.
Use `npm run onboarding:verify` as the repeatable local proof that the bootstrap can reach first
value through both typed-fallback and voice-ready paths, persist its transcript, preserve the
required answer input methods, bridge a desktop STT final transcript, and seed the Desk assistant
handoff before running notarized desktop release checks.
