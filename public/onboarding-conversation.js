/* Deterministic onboarding conversation controller.
   Owns prompts, slots, and answer metadata. It does not call Store, fetch,
   desktop APIs, speech APIs, or model routes. */
(function () {
  const runtime = window.KP_CONVERSATIONAL_ONBOARDING || {};
  const copy = window.KP_ONBOARDING_COPY || {};
  const manifest = window.KP_BOOTSTRAP_MANIFEST || window.KP_ONBOARDING_MANIFEST || runtime.manifest || {};
  const manifestSlots = manifest.slots || {};

  function clonePlain(value) {
    if (value === undefined || value === null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_err) {
      return value;
    }
  }

  const CONVERSATION_VERSION = "2026-06-10.kings-press-conversation-controller.v1";
  const defaultSlotIds = {
    INTRO_CONSENT: "intro_consent",
    VOICE_SETUP: "voice_setup",
    COMMUNICATION_PLATFORMS: "communication_platforms",
    VOICE_PROFILE: "voice_profile",
  };
  const SLOT_IDS = Object.assign({}, defaultSlotIds, manifestSlots.ids || {});
  const REQUIRED_SLOTS = Array.isArray(manifestSlots.required) && manifestSlots.required.length
    ? manifestSlots.required.slice()
    : [SLOT_IDS.COMMUNICATION_PLATFORMS, SLOT_IDS.VOICE_PROFILE];
  const QUESTION_SEQUENCE = Array.isArray(manifestSlots.sequence) && manifestSlots.sequence.length
    ? manifestSlots.sequence.slice()
    : [
    SLOT_IDS.INTRO_CONSENT,
    SLOT_IDS.VOICE_SETUP,
    SLOT_IDS.COMMUNICATION_PLATFORMS,
    SLOT_IDS.VOICE_PROFILE,
  ];

  const defaultSlotPrompts = {
    [SLOT_IDS.INTRO_CONSENT]: {
      stepId: "intro",
      question: "Would you like a guided intro, or a voice-guided intro?",
      helper: "If yes, I will offer voice setup first, then models and integrations. If you skip, you will go straight to the desk.",
      placeholder: "Type yes, guide me, or skip setup.",
      actionLabel: "Use answer",
      answerKind: "intro_consent",
      required: false,
    },
    [SLOT_IDS.VOICE_SETUP]: {
      stepId: "voice",
      question: "Can I help you set up voice?",
      helper: "Voice lets you speak setup answers, dictate drafts, and hear work read aloud. OpenAI is the easiest first key because it can also power the rest of setup.",
      placeholder: "Type yes, no, OpenAI, ElevenLabs, or ask how to get a key.",
      actionLabel: "Use answer",
      answerKind: "voice_setup",
      required: false,
    },
    [SLOT_IDS.COMMUNICATION_PLATFORMS]: {
      stepId: "focus",
      question: copy.FIRST_PLATFORM_QUESTION || "Where do you communicate most?",
      helper: "Answer naturally. I will turn this into a first focus and platform defaults.",
      placeholder: "e.g. LinkedIn, Substack, scripts, and book chapters.",
      actionLabel: "Capture answer",
      answerKind: "communication_platforms",
      required: true,
    },
    [SLOT_IDS.VOICE_PROFILE]: {
      stepId: "preferences",
      question: "Tell me how this desk should sound for you.",
      helper: "Say who you are, who you write for, and how much polish you want.",
      placeholder: "e.g. Clear, useful, direct. I write for independent operators and want drafts that preserve my point of view.",
      actionLabel: "Use for defaults",
      answerKind: "voice_profile",
      required: true,
    },
  };
  const slotPrompts = Object.assign({}, defaultSlotPrompts, clonePlain(manifestSlots.prompts || {}));

  function cleanText(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return maxLength ? text.slice(0, maxLength) : text;
  }

  function redactSensitiveText(value) {
    return String(value || "")
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
      .replace(/sk-[A-Za-z0-9._-]{12,}/gi, "sk-[redacted]")
      .replace(/api[_-]?key[=:]?\s*[^&\s]+/gi, "api_key=[redacted]")
      .replace(/password[=:]?\s*[^&\s]+/gi, "password=[redacted]");
  }

  const INTENT_PATTERNS = {
    affirm: [/\byes\b/i, /\byeah\b/i, /\byep\b/i, /\bsure\b/i, /\bok(?:ay)?\b/i, /\bgo ahead\b/i, /\bguide me\b/i],
    deny: [/\bno\b/i, /\bnope\b/i, /\bdon't\b/i, /\bdo not\b/i],
    skip: [/\bskip\b/i, /\bnot now\b/i, /\blater\b/i, /\bdo this later\b/i],
    help: [/\bhelp\b/i, /\bhow\b/i, /\bexplain\b/i, /\bwhat does\b/i, /\bget a key\b/i],
    repeat: [/\brepeat\b/i, /\bsay that again\b/i, /\bagain\b/i],
    voice: [/\bvoice\b/i, /\baudio\b/i, /\bspeak\b/i, /\bmic(?:rophone)?\b/i, /\bread aloud\b/i],
    provider_key: [/\bopenai\b/i, /\belevenlabs\b/i, /\bhedra\b/i, /\banthropic\b/i, /\bgemini\b/i, /\bxai\b/i, /\bgrok\b/i, /\bollama\b/i, /\bdocker\b/i, /\bapi[_ -]?key\b/i, /\bsk-[A-Za-z0-9._-]{8,}/i],
  };

  const defaultRepairSuggestions = {
    [SLOT_IDS.INTRO_CONSENT]: [
      { label: "Guide me", value: "yes, guide me", intent: "affirm" },
      { label: "Voice-guided intro", value: "yes, voice-guided intro", intent: "voice" },
      { label: "Skip setup", value: "skip setup", intent: "skip" },
    ],
    [SLOT_IDS.VOICE_SETUP]: [
      { label: "Set up voice", value: "yes, set up voice", intent: "affirm" },
      { label: "Skip voice", value: "skip voice", intent: "skip" },
      { label: "Help me get a key", value: "help me get a key", intent: "help" },
    ],
    [SLOT_IDS.COMMUNICATION_PLATFORMS]: [
      { label: "LinkedIn and Substack", value: "LinkedIn and Substack", intent: "typed_answer" },
      { label: "Book chapters", value: "book chapters", intent: "typed_answer" },
      { label: "Skip for now", value: "skip for now", intent: "skip" },
    ],
    [SLOT_IDS.VOICE_PROFILE]: [
      { label: "Polished and direct", value: "polished, direct, and useful", intent: "typed_answer" },
      { label: "Plainspoken", value: "plainspoken and clear", intent: "typed_answer" },
      { label: "Skip for now", value: "skip for now", intent: "skip" },
    ],
  };

  function firstMatchingIntent(text) {
    const clean = cleanText(text, 5000);
    if (!clean) return { intent: "empty", confidence: 1 };
    const order = ["skip", "deny", "help", "repeat", "voice", "provider_key", "affirm"];
    for (const intent of order) {
      if ((INTENT_PATTERNS[intent] || []).some((pattern) => pattern.test(clean))) {
        return { intent, confidence: 0.9 };
      }
    }
    if (clean.length >= 3) return { intent: "typed_answer", confidence: 0.65 };
    return { intent: "unclear", confidence: 0.2 };
  }

  function normalizeIntent(slotId, answer) {
    const prompt = slotPrompts[slotId];
    const clean = cleanText(answer, 5000);
    const match = firstMatchingIntent(clean);
    const expected = (prompt && prompt.expectedIntents) || [];
    const allowed = expected.length ? expected : ["affirm", "deny", "skip", "help", "repeat", "typed_answer", "spoken_answer"];
    const intent = match.intent === "typed_answer" && allowed.includes("spoken_answer") ? "typed_answer" : match.intent;
    const accepted =
      intent !== "empty" &&
      intent !== "unclear" &&
      (allowed.includes(intent) ||
        (intent === "typed_answer" && (allowed.includes("typed_answer") || allowed.includes("spoken_answer"))) ||
        (intent === "voice" && (allowed.includes("voice") || allowed.includes("affirm"))));
    return {
      slotId,
      intent,
      accepted,
      confidence: accepted ? match.confidence : Math.min(match.confidence, 0.35),
      text: cleanText(redactSensitiveText(clean), 5000),
      expectedIntents: allowed,
    };
  }

  function repairForAnswer(slotId, answer) {
    const normalized = normalizeIntent(slotId, answer);
    if (normalized.accepted && normalized.intent !== "help" && normalized.intent !== "repeat") {
      return Object.assign({}, normalized, {
        needsRepair: false,
        message: "",
        suggestions: [],
      });
    }
    const prompt = slotPrompts[slotId] || {};
    const suggestions = clonePlain(defaultRepairSuggestions[slotId] || [
      { label: "Try again", value: "", intent: "typed_answer" },
      { label: "Skip for now", value: "skip for now", intent: "skip" },
    ]);
    const message = normalized.intent === "empty"
      ? "I need a little more before I can use that answer."
      : prompt.question
        ? "I am not sure which path you meant. Choose one of these, or type a clearer answer."
        : "I am not sure what to do with that yet.";
    return Object.assign({}, normalized, {
      needsRepair: true,
      message,
      suggestions,
    });
  }

  function defaultSlot(id) {
    return {
      id,
      status: "empty",
      inputMethod: null,
      answeredAt: null,
      answerLength: 0,
      answerPreview: "",
    };
  }

  function createState(input) {
    const current = input || {};
    const slots = Object.assign({}, QUESTION_SEQUENCE.reduce((acc, id) => Object.assign(acc, { [id]: defaultSlot(id) }), {}), current.slots || {});
    return {
      version: CONVERSATION_VERSION,
      currentSlot: current.currentSlot || nextOpenQuestion(slots) || SLOT_IDS.INTRO_CONSENT,
      slots,
    };
  }

  function slotForStep(stepId) {
    const match = Object.entries(slotPrompts).find(([, prompt]) => prompt.stepId === stepId);
    return match ? match[0] : null;
  }

  function nextOpenSlot(slots) {
    const current = slots || {};
    return REQUIRED_SLOTS.find((id) => !current[id] || current[id].status !== "answered") || null;
  }

  function nextOpenQuestion(slots) {
    const current = slots || {};
    return QUESTION_SEQUENCE.find((id) => !current[id] || current[id].status === "empty") || null;
  }

  function progressForState(stateInput) {
    const state = createState(stateInput);
    const answered = REQUIRED_SLOTS.filter((id) => state.slots[id] && state.slots[id].status === "answered").length;
    return {
      required: REQUIRED_SLOTS.length,
      answered,
      remaining: REQUIRED_SLOTS.length - answered,
      percent: Math.round((answered / REQUIRED_SLOTS.length) * 100),
      complete: answered === REQUIRED_SLOTS.length,
      text: answered + " of " + REQUIRED_SLOTS.length + " setup answers captured",
    };
  }

  function promptForStep(stepId, stateInput) {
    const state = createState(stateInput);
    const slotId = slotForStep(stepId);
    if (!slotId) return null;
    const prompt = slotPrompts[slotId];
    const slot = state.slots[slotId] || defaultSlot(slotId);
    const progress = progressForState(state);
    return Object.assign({}, prompt, {
      slotId,
      slotStatus: slot.status,
      answered: slot.status === "answered",
      progress,
      progressText: progress.text,
    });
  }

  function captureAnswer(stateInput, slotId, answer, inputMethod) {
    const state = createState(stateInput);
    const clean = cleanText(answer, 5000);
    if (!slotPrompts[slotId] || !clean) return state;
    const safeAnswer = cleanText(redactSensitiveText(clean), 5000);
    const slots = Object.assign({}, state.slots, {
      [slotId]: {
        id: slotId,
        status: "answered",
        inputMethod: cleanText(inputMethod || "typed", 32) || "typed",
        answeredAt: new Date().toISOString(),
        answerLength: safeAnswer.length,
        answerPreview: cleanText(safeAnswer, 120),
        answerText: safeAnswer,
      },
    });
    return createState({
      slots,
      currentSlot: nextOpenQuestion(slots) || slotId,
    });
  }

  function skipSlot(stateInput, slotId) {
    const state = createState(stateInput);
    if (!slotPrompts[slotId]) return state;
    const slots = Object.assign({}, state.slots, {
      [slotId]: Object.assign({}, state.slots[slotId] || defaultSlot(slotId), {
        status: "skipped",
        answeredAt: new Date().toISOString(),
      }),
    });
    return createState({
      slots,
      currentSlot: nextOpenQuestion(slots) || state.currentSlot,
    });
  }

  function metricForAnswer(slotId, inputMethod) {
    const prompt = slotPrompts[slotId];
    return {
      stepId: prompt ? prompt.stepId : null,
      inputMethod: cleanText(inputMethod || "typed", 32) || "typed",
      answerKind: prompt ? prompt.answerKind : cleanText(slotId, 64),
      conversational: true,
      answerAccepted: !!prompt,
    };
  }

  function safePermissions() {
    return {
      mayUseSavedMemory: false,
      mayUseUploadedVoiceExamples: false,
      mayUseWebResearch: false,
      mayPublishOrSend: false,
    };
  }

  function transcriptForState(stateInput) {
    const state = createState(stateInput);
    const turns = [];
    QUESTION_SEQUENCE.forEach((slotId) => {
      const prompt = slotPrompts[slotId];
      const slot = state.slots[slotId];
      if (!prompt || !slot || (slot.status !== "answered" && slot.status !== "skipped")) return;
      turns.push({
        role: "assistant",
        slotId,
        stepId: prompt.stepId,
        text: prompt.question,
      });
      turns.push({
        role: "user",
        slotId,
        stepId: prompt.stepId,
        inputMethod: slot.inputMethod || null,
        status: slot.status,
        text: slot.status === "skipped"
          ? "I'll skip this for now."
          : cleanText(redactSensitiveText(slot.answerText || slot.answerPreview), 5000),
        at: slot.answeredAt || null,
      });
    });
    return {
      version: CONVERSATION_VERSION,
      capturedAt: new Date().toISOString(),
      currentSlot: state.currentSlot,
      complete: progressForState(state).complete,
      progress: progressForState(state),
      turns,
      permissions: safePermissions(),
    };
  }

  window.KP_ONBOARDING_CONVERSATION = {
    CONVERSATION_VERSION,
    manifestVersion: manifest.version || null,
    SLOT_IDS,
    REQUIRED_SLOTS,
    QUESTION_SEQUENCE,
    slotPrompts,
    createState,
    slotForStep,
    nextOpenSlot,
    nextOpenQuestion,
    progressForState,
    promptForStep,
    normalizeIntent,
    repairForAnswer,
    captureAnswer,
    skipSlot,
    metricForAnswer,
    safePermissions,
    transcriptForState,
  };
})();
