import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const root = process.cwd();
const publicDir = join(root, "public");

type ProofContext = ReturnType<typeof createWindow>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function loadPublicScript(name: string) {
  return await readFile(join(publicDir, name), "utf8");
}

function createWindow(options?: { voiceReady?: boolean }) {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const storage = new Map<string, string>();
  const campaigns: any[] = [];
  const referencesByCampaign = new Map<string, any>();
  const prefs: Record<string, any> = {};
  let activeCampaignId: string | null = null;
  let deskState: any = { threads: [], activeId: null };
  let sttFinalHandler: null | ((event: any) => void) = null;

  const window: any = {
    KP_ONBOARDING_COPY: {
      AUDIO_INTRO_COPY_VERSION: "release-proof-copy",
      FIRST_PLATFORM_QUESTION: "Where do you communicate most?",
      getAudioReadyPrompt: () => "Audio is connected.",
      getPressIntroScript: () => "I'm King's Press.",
    },
    KINGS_DESKTOP: {
      isDesktop: () => true,
      startVoiceSession: async () => undefined,
      onSttFinal: async (handler: (event: any) => void) => {
        sttFinalHandler = handler;
        return () => {
          sttFinalHandler = null;
        };
      },
    },
    localStorage: {
      getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
      setItem: (key: string, value: string) => {
        storage.set(key, String(value));
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
    addEventListener: (name: string, handler: (event: any) => void) => {
      listeners.set(name, (listeners.get(name) || []).concat(handler));
    },
    removeEventListener: (name: string, handler: (event: any) => void) => {
      listeners.set(name, (listeners.get(name) || []).filter((item) => item !== handler));
    },
    dispatchEvent: (event: any) => {
      for (const handler of listeners.get(event.type) || []) handler(event);
      return true;
    },
  };

  window.Store = {
    getPref: (key: string, fallback: unknown) => Object.prototype.hasOwnProperty.call(prefs, key) ? prefs[key] : fallback,
    setPref: (key: string, value: unknown) => {
      prefs[key] = value;
    },
    setPrefs: (patch: Record<string, unknown>) => {
      Object.assign(prefs, patch);
    },
    addCampaign: (name: string) => {
      const id = "campaign_" + String(campaigns.length + 1);
      const campaign = { id, name };
      campaigns.push(campaign);
      activeCampaignId = id;
      referencesByCampaign.set(id, {
        strategy: { throughlines: [] },
        audiences: { list: [] },
        registers: { list: [] },
        voiceRules: { rules: [] },
        redLines: { rules: [] },
        selfVision: { body: "" },
        gateSpec: { body: "" },
      });
      return id;
    },
    whenCampaignSaved: async (id: string) => campaigns.find((campaign) => campaign.id === id) || null,
    setActiveCampaign: (id: string) => {
      activeCampaignId = id;
    },
    getCampaign: (id: string) => campaigns.find((campaign) => campaign.id === id) || null,
    activeReferences: () => referencesByCampaign.get(activeCampaignId || "") || {},
    updateReferences: async (patch: Record<string, unknown>) => {
      assert(activeCampaignId, "Cannot save references without an active campaign.");
      const current = referencesByCampaign.get(activeCampaignId) || {};
      referencesByCampaign.set(activeCampaignId, Object.assign({}, current, patch));
      return { saved: true };
    },
    getDesk: () => deskState,
    setDesk: (next: any) => {
      deskState = next;
    },
  };

  const navigator = options?.voiceReady
    ? {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => undefined }],
        }),
      },
    }
    : {};

  return {
    window,
    navigator,
    storage,
    campaigns,
    referencesByCampaign,
    prefs,
    emitSttFinal(transcript: string) {
      assert(sttFinalHandler, "STT final handler was not registered.");
      sttFinalHandler({ payload: { transcript } });
    },
    get activeCampaignId() {
      return activeCampaignId;
    },
    get deskState() {
      return deskState;
    },
  };
}

function CustomEvent(type: string, init?: { detail?: unknown }) {
  return { type, detail: init?.detail };
}

function Event(type: string) {
  return { type };
}

async function loadRuntime(context: ProofContext) {
  const scriptNames = [
    "onboarding-manifest.js",
    "onboarding-runtime.js",
    "onboarding-conversation.js",
    "onboarding-profile.js",
    "onboarding-actions.js",
  ];

  for (const name of scriptNames) {
    runInNewContext(await loadPublicScript(name), {
      window: context.window,
      Date,
      CustomEvent,
      Event,
      navigator: context.navigator,
      fetch: async () => ({
        ok: false,
        json: async () => ({ error: "No network in onboarding release proof." }),
      }),
      console,
    });
  }

  const runtime = context.window.KP_CONVERSATIONAL_ONBOARDING;
  const conversation = context.window.KP_ONBOARDING_CONVERSATION;
  const profile = context.window.KP_ONBOARDING_PROFILE;
  const actions = context.window.KP_ONBOARDING_ACTIONS;

  assert(runtime, "Missing onboarding runtime.");
  assert(conversation, "Missing onboarding conversation controller.");
  assert(profile, "Missing onboarding profile helpers.");
  assert(actions, "Missing onboarding action registry.");

  return { runtime, conversation, profile, actions };
}

async function runActivationProof(input: {
  id: string;
  voiceReady: boolean;
  requiredInputMethod: "typed" | "voice";
  focusAnswer: string;
  profileAnswer: string;
}) {
  const context = createWindow({ voiceReady: input.voiceReady });
  const { runtime, conversation, profile, actions } = await loadRuntime(context);
  const sessionId = "release-proof-" + input.id;

  let state = conversation.createState();
  actions.recordMetric(runtime.METRIC_EVENTS.STARTED, {
    sessionId,
    stepId: "intro",
  });

  const unclear = conversation.repairForAnswer(conversation.SLOT_IDS.INTRO_CONSENT, "maybe maybe");
  assert(unclear.needsRepair === true, input.id + ": unclear intro answer did not request repair.");
  actions.recordMetric(runtime.METRIC_EVENTS.ANSWER_REPAIRED, {
    sessionId,
    stepId: "intro",
    repairReason: "unclear intro answer",
    repairIntent: unclear.intent,
    conversational: true,
    answerAccepted: false,
  });

  state = conversation.captureAnswer(state, conversation.SLOT_IDS.INTRO_CONSENT, "yes, guide me", "button");

  if (input.voiceReady) {
    const voiceResult = await actions.requestVoice();
    assert(voiceResult.status === runtime.ACTION_STATUSES.SUCCEEDED, input.id + ": voice request did not succeed.");

    let heard = "";
    const unlisten = await actions.onSttFinal((event: any) => {
      heard = event.transcript;
    });
    context.emitSttFinal(input.focusAnswer);
    assert(heard === input.focusAnswer, input.id + ": desktop STT final transcript was not bridged.");
    if (typeof unlisten === "function") unlisten();

    state = conversation.captureAnswer(
      state,
      conversation.SLOT_IDS.VOICE_SETUP,
      "voice connected",
      "voice",
    );
  } else {
    state = conversation.skipSlot(state, conversation.SLOT_IDS.VOICE_SETUP);
    actions.recordMetric(runtime.METRIC_EVENTS.FALLBACK_USED, {
      sessionId,
      stepId: "voice",
      fallbackKind: "typing",
      fallbackReason: "voice_deferred",
    });
  }

  state = conversation.captureAnswer(
    state,
    conversation.SLOT_IDS.COMMUNICATION_PLATFORMS,
    input.focusAnswer,
    input.requiredInputMethod,
  );
  actions.recordMetric(
    runtime.METRIC_EVENTS.ANSWER_CAPTURED,
    Object.assign(
      { sessionId },
      conversation.metricForAnswer(conversation.SLOT_IDS.COMMUNICATION_PLATFORMS, input.requiredInputMethod),
    ),
  );

  const setupDraft = profile.buildProfileDraft({
    transcript: input.focusAnswer,
  });

  state = conversation.captureAnswer(
    state,
    conversation.SLOT_IDS.VOICE_PROFILE,
    input.profileAnswer,
    input.requiredInputMethod,
  );
  actions.recordMetric(
    runtime.METRIC_EVENTS.ANSWER_CAPTURED,
    Object.assign(
      { sessionId },
      conversation.metricForAnswer(conversation.SLOT_IDS.VOICE_PROFILE, input.requiredInputMethod),
    ),
  );

  const focusResult = await actions.saveFocus("Release proof " + input.id + " focus", { campaigns: [] });
  assert(focusResult.status === runtime.ACTION_STATUSES.SUCCEEDED, input.id + ": first focus was not saved.");
  const campaignId = focusResult.data?.campaignId;
  assert(campaignId, input.id + ": first focus did not return a campaign id.");

  const seededPrefs = profile.applyProfileToPreferences(setupDraft, {
    selfVision: input.profileAnswer,
    strategy: "",
    throughlineTag: "core",
    throughlineName: "",
    throughlineNote: "",
    audienceId: "general",
    audienceName: "",
    audienceNote: "",
    registerBody: "",
    voiceRules: "",
    redLines: "",
    gateSpec: "",
  });

  const preferencesResult = await actions.savePreferences({
    strategy: { body: seededPrefs.strategy, throughlines: [] },
    audiences: { list: [{ id: "general", name: seededPrefs.audienceName || "Independent operators", note: seededPrefs.audienceNote || "" }] },
    registers: { body: seededPrefs.registerBody || "Default draft style: polished." },
    voiceRules: { rules: [] },
    redLines: { rules: [] },
    selfVision: { body: seededPrefs.selfVision || input.profileAnswer },
    gateSpec: { body: "" },
    setupProfile: {
      version: setupDraft.version || 1,
      approvedAt: new Date().toISOString(),
      profile: setupDraft,
    },
  });
  assert(preferencesResult.status === runtime.ACTION_STATUSES.SUCCEEDED, input.id + ": preferences were not saved.");

  const transcript = conversation.transcriptForState(state);
  assert(transcript.complete === true, input.id + ": setup transcript did not mark required answers complete.");
  const requiredTurns = transcript.turns.filter((turn: any) => turn.role === "user" && turn.inputMethod === input.requiredInputMethod);
  assert(requiredTurns.length >= 2, input.id + ": required setup answers were not persisted with input method " + input.requiredInputMethod + ".");

  const completeResult = await actions.completeOnboarding({
    sessionId,
    firstValueComplete: true,
    firstValue: {
      campaignId,
      campaignName: "Release proof " + input.id + " focus",
      focusReady: true,
      preferencesSaved: true,
      providerReady: false,
      routeTarget: "desk",
      setupDurationMs: input.voiceReady ? 90000 : 120000,
      completedFrom: "release_proof_" + input.id,
    },
    transcript,
  });

  assert(completeResult.status === runtime.ACTION_STATUSES.SUCCEEDED, input.id + ": onboarding did not complete.");
  assert(context.prefs.setupHelperCompleteV1 === true, input.id + ": onboarding completion pref was not saved.");
  assert(context.prefs.onboardingFirstValueEventV1?.complete === true, input.id + ": first-value activation was not persisted.");
  assert(context.prefs.onboardingSetupTranscriptV1?.turns?.length >= 6, input.id + ": setup transcript was not persisted.");
  assert(context.prefs.onboardingAssistantHandoffV1?.deskThreadId, input.id + ": Desk handoff was not persisted.");
  assert(context.deskState.activeId === context.prefs.onboardingAssistantHandoffV1.deskThreadId, input.id + ": Desk handoff thread is not active.");
  assert(context.deskState.threads[0]?.source === "kings_press_setup", input.id + ": Desk handoff thread has the wrong source.");

  const savedRefs = context.referencesByCampaign.get(campaignId);
  assert(savedRefs?.setupProfile?.profile, input.id + ": approved setup profile was not saved to references.");
  assert(context.prefs.onboardingMetricsSummaryV1?.firstValueActivations >= 1, input.id + ": activation was not counted.");
  assert(context.prefs.onboardingMetricsSummaryV1?.repairsShown >= 1, input.id + ": repair metric was not counted.");
  if (!input.voiceReady) {
    assert(context.prefs.onboardingMetricsSummaryV1?.fallbacksUsed >= 1, input.id + ": fallback metric was not counted.");
  }

  return {
    id: input.id,
    campaignId,
    deskThreadId: context.prefs.onboardingAssistantHandoffV1.deskThreadId,
    transcriptTurns: context.prefs.onboardingSetupTranscriptV1.turns.length,
    requiredInputMethod: input.requiredInputMethod,
    metricsSummary: context.prefs.onboardingMetricsSummaryV1,
  };
}

const typed = await runActivationProof({
  id: "typed",
  voiceReady: false,
  requiredInputMethod: "typed",
  focusAnswer: "LinkedIn, Substack, and book chapters",
  profileAnswer: "I write for independent operators. Keep it clear, practical, and lightly polished.",
});

const voice = await runActivationProof({
  id: "voice",
  voiceReady: true,
  requiredInputMethod: "voice",
  focusAnswer: "LinkedIn, newsletters, scripts, and book chapters",
  profileAnswer: "I want the desk to sound plainspoken, precise, and useful for founders.",
});

console.log("ok onboarding activation proof");
console.log(JSON.stringify({ scenarios: [typed, voice] }, null, 2));
