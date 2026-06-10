/* Deterministic onboarding conversation controller.
   Owns prompts, slots, and answer metadata. It does not call Store, fetch,
   desktop APIs, speech APIs, or model routes. */
(function () {
  const runtime = window.KP_CONVERSATIONAL_ONBOARDING || {};
  const copy = window.KP_ONBOARDING_COPY || {};

  const CONVERSATION_VERSION = "2026-06-10.kings-press-conversation-controller.v1";
  const SLOT_IDS = {
    INTRO_CONSENT: "intro_consent",
    VOICE_SETUP: "voice_setup",
    COMMUNICATION_PLATFORMS: "communication_platforms",
    VOICE_PROFILE: "voice_profile",
  };
  const REQUIRED_SLOTS = [SLOT_IDS.COMMUNICATION_PLATFORMS, SLOT_IDS.VOICE_PROFILE];
  const QUESTION_SEQUENCE = [
    SLOT_IDS.INTRO_CONSENT,
    SLOT_IDS.VOICE_SETUP,
    SLOT_IDS.COMMUNICATION_PLATFORMS,
    SLOT_IDS.VOICE_PROFILE,
  ];

  const slotPrompts = {
    [SLOT_IDS.INTRO_CONSENT]: {
      stepId: "connect",
      question: "Can I introduce myself and give you a short orientation?",
      helper: "If you want to hear it aloud, I can help set up voice next. You can also skip straight to model setup.",
      placeholder: "Type yes, introduce yourself, or skip for now.",
      actionLabel: "Use answer",
      answerKind: "intro_consent",
      required: false,
    },
    [SLOT_IDS.VOICE_SETUP]: {
      stepId: "connect_voice",
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

  function cleanText(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return maxLength ? text.slice(0, maxLength) : text;
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
    const slots = Object.assign({}, state.slots, {
      [slotId]: {
        id: slotId,
        status: "answered",
        inputMethod: cleanText(inputMethod || "typed", 32) || "typed",
        answeredAt: new Date().toISOString(),
        answerLength: clean.length,
        answerPreview: cleanText(clean, 120),
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

  window.KP_ONBOARDING_CONVERSATION = {
    CONVERSATION_VERSION,
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
    captureAnswer,
    skipSlot,
    metricForAnswer,
    safePermissions,
  };
})();
