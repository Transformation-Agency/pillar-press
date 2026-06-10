/* Reusable conversational onboarding runtime.
   This is deterministic app code, not model output. It defines the King's Press
   app pack plus a small state/action contract that the setup UI can render. */
(function () {
  const copy = window.KP_ONBOARDING_COPY || {};

  const RUNTIME_VERSION = "2026-06-10.kings-press-conversational-runtime.v1";
  const PACK_VERSION = "2026-06-10.kings-press-pack.v1";
  const METRICS_VERSION = 1;
  const MAX_METRICS_EVENTS = 120;

  const STEP_IDS = ["intro", "voice", "connect", "focus", "preferences"];

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
    RECORD_METRIC: "record_metric",
    SUBMIT_SENTIMENT: "submit_sentiment",
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
    metricsEventsPref: "onboardingMetricsEventsV1",
    metricsSummaryPref: "onboardingMetricsSummaryV1",
    sentimentPref: "onboardingSentimentV1",
  };

  const METRIC_EVENTS = {
    STARTED: "onboarding_started",
    STEP_VIEWED: "step_viewed",
    ANSWER_CAPTURED: "answer_captured",
    SKIPPED: "onboarding_skipped",
    FIRST_VALUE_COMPLETED: "first_value_completed",
    COMPLETED: "onboarding_completed",
    SENTIMENT_SUBMITTED: "sentiment_submitted",
    SENTIMENT_DISMISSED: "sentiment_dismissed",
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
    description: "A first focus exists and essential context defaults were saved.",
    requiredSignals: ["focus_ready", "preferences_saved"],
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
    [ACTION_INTENTS.RECORD_METRIC]: {
      label: "Record onboarding metric",
      requiresApproval: false,
      persistentEffect: "settings_prefs",
    },
    [ACTION_INTENTS.SUBMIT_SENTIMENT]: {
      label: "Submit onboarding sentiment",
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
        focusReady: false,
        preferencesSaved: false,
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
    return !!((fv.focusReady || fv.campaignId) && fv.preferencesSaved);
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

  function buildFirstValueEvent(input) {
    const current = input || {};
    const focusReady = !!(current.focusReady || current.campaignId);
    const preferencesSaved = !!current.preferencesSaved;
    const complete = focusReady && preferencesSaved;
    return {
      id: firstValueEvent.id,
      version: firstValueEvent.version,
      completedAt: complete ? (current.completedAt || new Date().toISOString()) : null,
      complete,
      focusReady,
      preferencesSaved,
      focusReadyOrSkipped: focusReady || !!current.focusSkipped,
      preferencesSavedOrSkipped: preferencesSaved || !!current.preferencesSkipped,
      focusSkipped: !!current.focusSkipped,
      preferencesSkipped: !!current.preferencesSkipped,
      campaignId: current.campaignId || null,
      campaignName: current.campaignName || "",
      providerReady: !!current.providerReady,
      routeTarget: current.routeTarget || (current.campaignId || current.focusSkipped ? "desk" : "library"),
      setupDurationMs: Math.max(0, Number(current.setupDurationMs || 0)),
      completedFrom: current.completedFrom || "setup_helper",
    };
  }

  function safeMetricString(value, maxLength) {
    const clean = String(value || "").trim();
    if (!clean) return "";
    return clean
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
      .replace(/api[_-]?key[=:]\s*[^&\s]+/gi, "api_key=[redacted]")
      .replace(/password[=:]\s*[^&\s]+/gi, "password=[redacted]")
      .slice(0, maxLength || 120);
  }

  function clampRating(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(5, Math.round(n)));
  }

  function buildMetricsEvent(type, input) {
    const current = input || {};
    const eventType = safeMetricString(type || current.type, 80) || METRIC_EVENTS.STEP_VIEWED;
    const stepId = current.stepId ? getStepById(current.stepId).id : null;
    const rating = clampRating(current.rating);
    const durationMs = Number(current.durationMs);
    return {
      id: current.id || ("metric-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36)),
      version: METRICS_VERSION,
      type: eventType,
      at: current.at || new Date().toISOString(),
      sessionId: safeMetricString(current.sessionId, 96),
      stepId,
      stepIndex: stepId ? getStepIndex(stepId) : null,
      inputMethod: safeMetricString(current.inputMethod, 32) || null,
      answerKind: safeMetricString(current.answerKind, 64) || null,
      conversational: current.conversational === undefined ? null : !!current.conversational,
      answerAccepted: current.answerAccepted === undefined ? null : !!current.answerAccepted,
      firstValueComplete: current.firstValueComplete === undefined ? null : !!current.firstValueComplete,
      routeTarget: safeMetricString(current.routeTarget, 64) || null,
      campaignId: safeMetricString(current.campaignId, 96) || null,
      skippedReason: safeMetricString(current.skippedReason, 96) || null,
      rating,
      durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    };
  }

  function appendMetricsEvent(events, event, maxEvents) {
    const list = Array.isArray(events) ? events.slice() : [];
    const next = buildMetricsEvent(event && event.type, event);
    list.push(next);
    return list.slice(-Math.max(1, Number(maxEvents || MAX_METRICS_EVENTS)));
  }

  function median(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function rate(part, total) {
    return total > 0 ? Math.round((part / total) * 1000) / 1000 : null;
  }

  function deriveMetricsSummary(events) {
    const list = Array.isArray(events) ? events : [];
    const count = (type) => list.filter((event) => event && event.type === type).length;
    const starts = count(METRIC_EVENTS.STARTED);
    const completed = count(METRIC_EVENTS.COMPLETED);
    const skipped = count(METRIC_EVENTS.SKIPPED);
    const sessionIds = new Set();
    const activatedSessions = new Set();
    let anonymousActivationSeen = false;
    list.forEach((event) => {
      if (event && event.sessionId) sessionIds.add(event.sessionId);
      if (!event || !(event.type === METRIC_EVENTS.FIRST_VALUE_COMPLETED || event.firstValueComplete === true)) return;
      if (event.sessionId) activatedSessions.add(event.sessionId);
      else anonymousActivationSeen = true;
    });
    const activations = activatedSessions.size + (anonymousActivationSeen ? 1 : 0);
    const answers = list.filter((event) => event && event.type === METRIC_EVENTS.ANSWER_CAPTURED);
    const conversationalAnswers = answers.filter((event) => event.conversational !== false);
    const acceptedConversationalAnswers = conversationalAnswers.filter((event) => event.answerAccepted !== false);
    const ratings = list
      .filter((event) => event && event.type === METRIC_EVENTS.SENTIMENT_SUBMITTED && Number.isFinite(Number(event.rating)))
      .map((event) => Number(event.rating));
    const durations = list
      .filter((event) => event && event.type === METRIC_EVENTS.COMPLETED && Number.isFinite(Number(event.durationMs)))
      .map((event) => Number(event.durationMs));
    const totalSessions = Math.max(starts, completed + skipped, sessionIds.size, 0);
    const averageSentiment = ratings.length
      ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10
      : null;
    return {
      version: METRICS_VERSION,
      updatedAt: new Date().toISOString(),
      sessionsStarted: starts,
      sessionsCompleted: completed,
      sessionsSkipped: skipped,
      firstValueActivations: activations,
      completionRate: rate(completed, totalSessions),
      activationRate: rate(activations, totalSessions),
      medianDurationMs: median(durations),
      conversationalAnswers: conversationalAnswers.length,
      conversationalAnswerSuccessRate: rate(acceptedConversationalAnswers.length, conversationalAnswers.length),
      sentimentResponses: ratings.length,
      averageSentiment,
      latestEventType: list.length ? list[list.length - 1].type : null,
    };
  }

  window.KP_CONVERSATIONAL_ONBOARDING = {
    RUNTIME_VERSION,
    PACK_VERSION,
    STEP_IDS,
    ACTION_INTENTS,
    ACTION_STATUSES,
    METRIC_EVENTS,
    METRICS_VERSION,
    MAX_METRICS_EVENTS,
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
    buildFirstValueEvent,
    buildMetricsEvent,
    appendMetricsEvent,
    deriveMetricsSummary,
  };
})();
