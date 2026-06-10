/* King's Press conversational bootstrap manifest.
   This file is app-owned product data. It should be safe to swap for another
   KingPress app without rewriting the shared onboarding runtime. */
(function () {
  const copy = window.KP_ONBOARDING_COPY || {};

  const MANIFEST_VERSION = "2026-06-10.kings-press-bootstrap-manifest.v1";

  const ACTIONS = {
    OPEN_PROVIDER_SETUP: "open_provider_setup",
    REQUEST_VOICE: "request_voice",
    EXPLORE_INTEGRATIONS: "explore_integrations",
    PLAY_INTRO: "play_intro",
    SKIP_INTRO: "skip_intro",
    SAVE_FOCUS: "save_focus",
    SKIP_FOCUS: "skip_focus",
    EXTRACT_SETUP_PROFILE: "extract_setup_profile",
    SAVE_PREFERENCES: "save_preferences",
    COMPLETE_ONBOARDING: "complete_onboarding",
    SKIP_ONBOARDING: "skip_onboarding",
    RECORD_METRIC: "record_metric",
    SUBMIT_SENTIMENT: "submit_sentiment",
  };

  const SLOT_IDS = {
    INTRO_CONSENT: "intro_consent",
    VOICE_SETUP: "voice_setup",
    COMMUNICATION_PLATFORMS: "communication_platforms",
    VOICE_PROFILE: "voice_profile",
  };

  const steps = [
    {
      id: "intro",
      label: "Intro",
      title: "I'm King's Press",
      subtitle: "I help you articulate your thoughts and turn them into clear, publishable work.",
      hostMessages: [
        "I can guide you through setup, including voice, models, and the first focus.",
        "You can also skip setup and go straight to the desk.",
      ],
      suggestions: ["Yes, guide me", "Skip setup"],
      motionState: "idle",
      primaryAction: "play_intro",
      secondaryAction: "skip_setup",
    },
    {
      id: "voice",
      label: "Voice",
      title: "Set up voice",
      subtitle: "Add voice now if you want King's Press to read and respond aloud.",
      hostMessages: [
        "Voice is optional.",
        "OpenAI is the simplest first key because it can also power the rest of setup.",
      ],
      suggestions: ["OpenAI", "ElevenLabs", "Skip voice"],
      motionState: "listening",
      primaryAction: "request_voice",
      secondaryAction: "skip_voice",
    },
    {
      id: "connect",
      label: "Connect",
      title: "Let's set up your desk",
      subtitle: "Choose the model and integrations King's Press can use. You can skip anything and change it later.",
      hostMessages: [
        "Now choose the model and any outside tools you want connected.",
        "Anything you skip stays available later.",
      ],
      suggestions: ["Cloud API key", "Ollama", "Explore integrations"],
      motionState: "idle",
      primaryAction: "continue",
      secondaryAction: "skip_setup",
    },
    {
      id: "focus",
      label: "First focus",
      title: "What are you working on first?",
      subtitle: "Your first focus helps organize drafts, sources, Gather runs, and notes in one place.",
      hostMessages: [
        "Give this first workspace a simple name.",
        "It can be a project, campaign, book draft, launch plan, or whatever you are making first.",
      ],
      suggestions: ["Use recent focus", "New focus", "Skip for now"],
      motionState: "listening",
      primaryAction: "save_focus",
      secondaryAction: "skip_focus",
    },
    {
      id: "preferences",
      label: "Preferences",
      title: "Set your defaults",
      subtitle: "Start with the basics. You can refine everything later.",
      hostMessages: [
        "Now give me the essentials: your voice, your audience, and the throughline.",
        "I will save only what you approve here. Advanced rules can wait.",
      ],
      suggestions: ["Polished", "Plainspoken", "Strategic", "Conversational"],
      motionState: "thinking",
      primaryAction: "finish_setup",
      secondaryAction: "skip_preferences",
    },
  ];

  const slotPrompts = {
    [SLOT_IDS.INTRO_CONSENT]: {
      stepId: "intro",
      question: "Would you like a guided intro, or a voice-guided intro?",
      helper: "If yes, I will offer voice setup first, then models and integrations. If you skip, you will go straight to the desk.",
      placeholder: "Type yes, guide me, or skip setup.",
      actionLabel: "Use answer",
      answerKind: "intro_consent",
      expectedIntents: ["affirm", "skip", "voice", "typed_answer", "spoken_answer", "unclear"],
      required: false,
    },
    [SLOT_IDS.VOICE_SETUP]: {
      stepId: "voice",
      question: "Can I help you set up voice?",
      helper: "Voice lets you speak setup answers, dictate drafts, and hear work read aloud. OpenAI is the easiest first key because it can also power the rest of setup.",
      placeholder: "Type yes, no, OpenAI, ElevenLabs, or ask how to get a key.",
      actionLabel: "Use answer",
      answerKind: "voice_setup",
      expectedIntents: ["affirm", "deny", "later", "help", "provider_key", "typed_answer", "spoken_answer", "unclear"],
      required: false,
    },
    [SLOT_IDS.COMMUNICATION_PLATFORMS]: {
      stepId: "focus",
      question: copy.FIRST_PLATFORM_QUESTION || "Where do you communicate most?",
      helper: "Answer naturally. I will turn this into a first focus and platform defaults.",
      placeholder: "e.g. LinkedIn, Substack, scripts, and book chapters.",
      actionLabel: "Capture answer",
      answerKind: "communication_platforms",
      expectedIntents: ["typed_answer", "spoken_answer", "correction", "skip", "unclear"],
      required: true,
    },
    [SLOT_IDS.VOICE_PROFILE]: {
      stepId: "preferences",
      question: "Tell me how this desk should sound for you.",
      helper: "Say who you are, who you write for, and how much polish you want.",
      placeholder: "e.g. Clear, useful, direct. I write for independent operators and want drafts that preserve my point of view.",
      actionLabel: "Use for defaults",
      answerKind: "voice_profile",
      expectedIntents: ["typed_answer", "spoken_answer", "correction", "skip", "unclear"],
      required: true,
    },
  };

  const manifest = {
    id: "kings_press",
    appName: "King's Press",
    version: MANIFEST_VERSION,
    runtimeVersion: "2026-06-10.kings-press-conversational-runtime.v1",
    packVersion: "2026-06-10.kings-press-pack.v1",
    persona: {
      role: "warm editorial setup host",
      tone: ["warm", "direct", "plainspoken", "premium"],
      boundaries: [
        "Do not imply King's Press replaces the writer.",
        "Do not infer permission to use memory, web research, external services, publishing, or sending.",
        "Ask one thing at a time and keep typing available.",
      ],
    },
    capabilities: {
      voiceInput: "optional",
      voiceOutput: "optional",
      localStt: "optional",
      llmProvider: "optional",
      liveAssistantHandoff: "after_provider_ready",
    },
    flags: {
      onboardingCompletePref: "setupHelperCompleteV1",
      computeSetupLocalStorageKey: "kingspress.desktopSetupComplete",
      firstValuePref: "onboardingFirstValueEventV1",
      metricsEventsPref: "onboardingMetricsEventsV1",
      metricsSummaryPref: "onboardingMetricsSummaryV1",
      sentimentPref: "onboardingSentimentV1",
    },
    trust: {
      reassurance: "You're in control. Nothing connects without your approval.",
      footer: "King's Press · Your desk for ideas that matter.",
      permissions: {
        microphone: "Voice setup starts only after you choose it.",
        memory: "Saved memory is off until you approve it.",
        web: "Web research is off until you approve it.",
        publish: "King's Press will not publish, send, or connect outside services without approval.",
      },
    },
    activation: {
      id: "first_usable_setup",
      version: 1,
      description: "A first focus exists and essential context defaults were saved.",
      requiredSignals: ["focus_ready", "preferences_saved"],
      persistedAs: "onboardingFirstValueEventV1",
    },
    slots: {
      ids: SLOT_IDS,
      required: [SLOT_IDS.COMMUNICATION_PLATFORMS, SLOT_IDS.VOICE_PROFILE],
      sequence: [
        SLOT_IDS.INTRO_CONSENT,
        SLOT_IDS.VOICE_SETUP,
        SLOT_IDS.COMMUNICATION_PLATFORMS,
        SLOT_IDS.VOICE_PROFILE,
      ],
      prompts: slotPrompts,
    },
    steps,
    graph: steps.map((step) => {
      const slotId = Object.keys(slotPrompts).find((id) => slotPrompts[id].stepId === step.id);
      const prompt = slotId ? slotPrompts[slotId] : null;
      return {
        id: step.id,
        goal: step.title,
        displayPrompt: prompt ? prompt.question : step.title,
        spokenPrompt: prompt ? [prompt.question, prompt.helper].filter(Boolean).join(" ") : step.subtitle,
        expectedIntents: prompt ? prompt.expectedIntents : ["continue", "skip", "help"],
        validation: {
          required: !!(prompt && prompt.required),
        },
        sideEffects: [step.primaryAction].filter(Boolean),
        skipBehavior: step.secondaryAction || "skip",
      };
    }),
    connectItems: [
      {
        id: "models",
        action: ACTIONS.OPEN_PROVIDER_SETUP,
        icon: "db",
        title: "AI & models",
        description: "Choose the models King's Press can use to think and create.",
        disconnectedStatus: "Not connected",
        connectedStatus: "Connected",
        label: "Set up",
        optional: true,
        approvalRequired: true,
      },
      {
        id: "voice",
        action: ACTIONS.REQUEST_VOICE,
        icon: "mic",
        title: "Voice",
        description: "Connect a microphone for voice input and guided setup.",
        disconnectedStatus: "Optional",
        connectedStatus: "Connected",
        label: "Connect",
        pendingLabel: "Connecting",
        optional: true,
        approvalRequired: true,
      },
      {
        id: "integrations",
        action: ACTIONS.EXPLORE_INTEGRATIONS,
        icon: "globe",
        title: "Integrations",
        description: "Bring in sources, media, and tools. You can add more anytime.",
        disconnectedStatus: "Not connected",
        connectedStatus: "Optional",
        label: "Explore",
        optional: true,
        approvalRequired: true,
      },
    ],
    actionMetadata: {
      [ACTIONS.OPEN_PROVIDER_SETUP]: {
        label: "Set up AI & models",
        requiresApproval: true,
        persistentEffect: "desktop_llm_settings",
        externalServices: ["ollama", "docker_model_runner", "cloud_llm_provider"],
      },
      [ACTIONS.REQUEST_VOICE]: {
        label: "Connect voice",
        requiresApproval: true,
        persistentEffect: "none",
        permissions: ["microphone"],
      },
      [ACTIONS.EXPLORE_INTEGRATIONS]: {
        label: "Explore integrations",
        requiresApproval: true,
        persistentEffect: "provider_settings",
        externalServices: ["gather_sources", "drive", "media_providers", "plugins"],
      },
      [ACTIONS.PLAY_INTRO]: {
        label: "Introduce King's Press",
        requiresApproval: true,
        persistentEffect: "none",
      },
      [ACTIONS.SAVE_FOCUS]: {
        label: "Save first focus",
        requiresApproval: false,
        persistentEffect: "campaign",
      },
      [ACTIONS.SAVE_PREFERENCES]: {
        label: "Save preferences",
        requiresApproval: true,
        persistentEffect: "campaign_references",
      },
      [ACTIONS.EXTRACT_SETUP_PROFILE]: {
        label: "Interpret setup answer",
        requiresApproval: false,
        persistentEffect: "none",
      },
      [ACTIONS.COMPLETE_ONBOARDING]: {
        label: "Complete onboarding",
        requiresApproval: false,
        persistentEffect: "settings_prefs",
      },
      [ACTIONS.SKIP_ONBOARDING]: {
        label: "Skip setup",
        requiresApproval: false,
        persistentEffect: "settings_prefs",
      },
      [ACTIONS.RECORD_METRIC]: {
        label: "Record onboarding metric",
        requiresApproval: false,
        persistentEffect: "settings_prefs",
      },
      [ACTIONS.SUBMIT_SENTIMENT]: {
        label: "Submit onboarding sentiment",
        requiresApproval: false,
        persistentEffect: "settings_prefs",
      },
    },
  };

  window.KP_BOOTSTRAP_MANIFEST = manifest;
  window.KP_ONBOARDING_MANIFEST = manifest;
})();
