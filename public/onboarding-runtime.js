/* Reusable conversational onboarding runtime.
   This is deterministic app code, not model output. It defines the King's Press
   app pack plus a small state/action contract that the setup UI can render. */
(function () {
  const copy = window.KP_ONBOARDING_COPY || {};

  const RUNTIME_VERSION = "2026-06-10.kings-press-conversational-runtime.v1";
  const PACK_VERSION = "2026-06-10.kings-press-pack.v1";

  const STEP_IDS = ["connect", "welcome", "focus", "preferences"];

  const steps = [
    {
      id: "connect",
      label: "Connect",
      title: "Let's set up your desk",
      subtitle: "Choose what to connect now. You can skip anything and change it later.",
      hostMessages: [
        "I can get your desk ready in a few minutes.",
        "Start with what you want connected now. Anything you skip stays available later.",
      ],
      suggestions: ["Fast start", "Guide me", "Type instead"],
      motionState: "idle",
      primaryAction: "continue",
      secondaryAction: "skip_setup",
    },
    {
      id: "welcome",
      label: "Welcome",
      eyebrow: "Welcome",
      title: "May I introduce myself?",
      subtitle: "I'm King's Press, your desk for turning ideas into clear, publishable work.",
      hostMessages: [
        "Before we shape your setup, I can give you a short orientation.",
        "If voice is connected, I can read it aloud. Either way, it stays on screen.",
      ],
      suggestions: ["Yes, introduce yourself", "Skip for now"],
      motionState: "speaking",
      primaryAction: "play_intro",
      secondaryAction: "skip_intro",
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

  const ACTION_INTENTS = {
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
  };

  const ACTION_STATUSES = {
    IDLE: "idle",
    PENDING: "pending",
    SUCCEEDED: "succeeded",
    FAILED: "failed",
    SKIPPED: "skipped",
  };

  const flags = {
    onboardingCompletePref: "setupHelperCompleteV1",
    computeSetupLocalStorageKey: "kingspress.desktopSetupComplete",
    firstValuePref: "onboardingFirstValueEventV1",
  };

  const trust = {
    reassurance: "You're in control. Nothing connects without your approval.",
    footer: "King's Press · Your desk for ideas that matter.",
    permissions: {
      microphone: "Voice setup starts only after you choose it.",
      memory: "Saved memory is off until you approve it.",
      web: "Web research is off until you approve it.",
      publish: "King's Press will not publish, send, or connect outside services without approval.",
    },
  };

  const firstValueEvent = {
    id: "first_usable_setup",
    version: 1,
    description: "A first focus exists and essential voice/context defaults were saved or explicitly skipped.",
    requiredSignals: ["focus_ready_or_skipped", "preferences_saved_or_skipped"],
    persistedAs: flags.firstValuePref,
  };

  const connectItems = [
    {
      id: "models",
      action: ACTION_INTENTS.OPEN_PROVIDER_SETUP,
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
      action: ACTION_INTENTS.REQUEST_VOICE,
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
      action: ACTION_INTENTS.EXPLORE_INTEGRATIONS,
      icon: "globe",
      title: "Integrations",
      description: "Bring in sources, media, and tools. You can add more anytime.",
      disconnectedStatus: "Not connected",
      connectedStatus: "Optional",
      label: "Explore",
      optional: true,
      approvalRequired: true,
    },
  ];

  const actionMetadata = {
    [ACTION_INTENTS.OPEN_PROVIDER_SETUP]: {
      label: "Set up AI & models",
      requiresApproval: true,
      persistentEffect: "desktop_llm_settings",
      externalServices: ["ollama", "docker_model_runner", "cloud_llm_provider"],
    },
    [ACTION_INTENTS.REQUEST_VOICE]: {
      label: "Connect voice",
      requiresApproval: true,
      persistentEffect: "none",
      permissions: ["microphone"],
    },
    [ACTION_INTENTS.EXPLORE_INTEGRATIONS]: {
      label: "Explore integrations",
      requiresApproval: true,
      persistentEffect: "provider_settings",
      externalServices: ["gather_sources", "drive", "media_providers", "plugins"],
    },
    [ACTION_INTENTS.PLAY_INTRO]: {
      label: "Introduce King's Press",
      requiresApproval: true,
      persistentEffect: "none",
    },
    [ACTION_INTENTS.SAVE_FOCUS]: {
      label: "Save first focus",
      requiresApproval: false,
      persistentEffect: "campaign",
    },
    [ACTION_INTENTS.SAVE_PREFERENCES]: {
      label: "Save preferences",
      requiresApproval: true,
      persistentEffect: "campaign_references",
    },
    [ACTION_INTENTS.EXTRACT_SETUP_PROFILE]: {
      label: "Interpret setup answer",
      requiresApproval: false,
      persistentEffect: "none",
    },
    [ACTION_INTENTS.COMPLETE_ONBOARDING]: {
      label: "Complete onboarding",
      requiresApproval: false,
      persistentEffect: "settings_prefs",
    },
    [ACTION_INTENTS.SKIP_ONBOARDING]: {
      label: "Skip setup",
      requiresApproval: false,
      persistentEffect: "settings_prefs",
    },
  };

  const pack = {
    id: "kings_press",
    brand: "King's Press",
    version: PACK_VERSION,
    persona: {
      role: "warm editorial setup host",
      tone: "warm, direct, plainspoken, premium",
      boundaries: [
        "Do not imply King's Press replaces the writer.",
        "Do not infer permission to use memory, web research, external services, publishing, or sending.",
        "Ask one thing at a time and keep typing available.",
      ],
    },
    steps,
    connect: { items: connectItems },
    firstValueEvent,
    trust,
    copy: {
      audioReady: typeof copy.getAudioReadyPrompt === "function" ? copy.getAudioReadyPrompt() : "",
      introScript: typeof copy.getPressIntroScript === "function" ? copy.getPressIntroScript("kings_press") : "",
      firstPlatformQuestion: copy.FIRST_PLATFORM_QUESTION || "",
      introCopyVersion: copy.AUDIO_INTRO_COPY_VERSION || null,
    },
    actionMetadata,
  };

  function clampStepIndex(value) {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    return Math.max(0, Math.min(steps.length - 1, Math.trunc(n)));
  }

  function getStepById(id) {
    return steps.find((step) => step.id === id) || steps[0];
  }

  function getStepConversation(id) {
    const step = getStepById(id);
    return {
      id: step.id,
      label: step.label,
      messages: step.hostMessages || [],
      suggestions: step.suggestions || [],
      motionState: step.motionState || "idle",
    };
  }

  function getStepIndex(id) {
    const index = steps.findIndex((step) => step.id === id);
    return index >= 0 ? index : 0;
  }

  function createInitialState(overrides) {
    const stepId = overrides && overrides.stepId ? overrides.stepId : steps[0].id;
    return Object.assign({
      stepId: getStepById(stepId).id,
      actionResults: {},
      permissions: {
        microphone: false,
        memory: false,
        webResearch: false,
        publishOrSend: false,
        externalServices: false,
      },
      firstValue: {
        focusReadyOrSkipped: false,
        preferencesSavedOrSkipped: false,
        completedAt: null,
      },
      error: null,
    }, overrides || {});
  }

  function normalizeActionResult(intent, result) {
    const next = Object.assign({
      intent,
      status: ACTION_STATUSES.IDLE,
      data: null,
      error: null,
      updatedAt: Date.now(),
    }, result || {});

    if (!Object.values(ACTION_STATUSES).includes(next.status)) {
      next.status = ACTION_STATUSES.IDLE;
    }
    if (next.error && typeof next.error !== "string") {
      next.error = (next.error && next.error.message) || "Action failed.";
    }
    return next;
  }

  function withActionResult(state, intent, result) {
    const current = state || createInitialState();
    const actionResults = Object.assign({}, current.actionResults || {});
    actionResults[intent] = normalizeActionResult(intent, result);
    return Object.assign({}, current, {
      actionResults,
      error: actionResults[intent].status === ACTION_STATUSES.FAILED ? actionResults[intent].error : current.error || null,
    });
  }

  function canComplete(state) {
    const current = state || createInitialState();
    const fv = current.firstValue || {};
    return !!(fv.focusReadyOrSkipped && fv.preferencesSavedOrSkipped);
  }

  function nextStepId(currentStepId) {
    const index = getStepIndex(currentStepId);
    return steps[Math.min(index + 1, steps.length - 1)].id;
  }

  function previousStepId(currentStepId) {
    const index = getStepIndex(currentStepId);
    return steps[Math.max(index - 1, 0)].id;
  }

  function getConnectItems(status) {
    const current = status || {};
    return connectItems.map((item) => {
      const connected =
        (item.id === "models" && !!current.providerConnected) ||
        (item.id === "voice" && !!current.voiceConnected) ||
        (item.id === "integrations" && !!current.integrationsTouched);
      const pending = item.id === "voice" && !!current.voicePending;
      return Object.assign({}, item, {
        status: connected ? item.connectedStatus : item.disconnectedStatus,
        label: pending && item.pendingLabel ? item.pendingLabel : item.label,
        connected,
        pending,
      });
    });
  }

  function deriveCompletionStatus(args) {
    const input = args || {};
    return {
      onboardingComplete: !!input.onboardingComplete,
      computeReady: !!input.computeReady,
      firstValueComplete: !!input.firstValueComplete,
      canEnterWorkspace: !!input.onboardingComplete || !!input.firstValueComplete,
      flags,
    };
  }

  window.KP_CONVERSATIONAL_ONBOARDING = {
    RUNTIME_VERSION,
    PACK_VERSION,
    STEP_IDS,
    ACTION_INTENTS,
    ACTION_STATUSES,
    flags,
    pack,
    steps,
    trust,
    firstValueEvent,
    actionMetadata,
    clampStepIndex,
    getStepById,
    getStepConversation,
    getStepIndex,
    createInitialState,
    normalizeActionResult,
    withActionResult,
    canComplete,
    nextStepId,
    previousStepId,
    getConnectItems,
    deriveCompletionStatus,
  };
})();
