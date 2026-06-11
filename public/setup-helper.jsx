/* First-run setup helper. Keeps secrets in the native provider dialog and
   writes preferences through the existing Store/references routes. */

const ONBOARDING_COPY = window.KP_ONBOARDING_COPY || {
  getPressIntroScript: () => "I'm Pillar Press.\n\nTo start, tell me where you communicate most.",
};
const ONBOARDING_AUDIO = window.KP_ONBOARDING_AUDIO || {
  speakText: () => Promise.resolve(),
  stopSpeaking: () => {},
};
const ONBOARDING_RUNTIME = window.KP_CONVERSATIONAL_ONBOARDING || null;
const ONBOARDING_ACTION_REGISTRY = window.KP_ONBOARDING_ACTIONS || null;
const ONBOARDING_PROFILE = window.KP_ONBOARDING_PROFILE || {
  buildProfileDraft: ({ transcript }) => ({
    version: "fallback",
    brand: "pillar_press",
    sourceTranscript: String(transcript || ""),
    communicationPlatforms: [],
    publicationDefaults: { defaultOutputTypes: ["custom"], preserveRawLanguage: "polish_lightly", humanReviewRequired: true },
    permissions: { mayUseSavedMemory: false, mayUseUploadedVoiceExamples: false, mayUseWebResearch: false, mayPublishOrSend: false },
  }),
  applyProfileToPreferences: (_profile, draft) => Object.assign({}, draft || {}),
  draftStyleForProfile: () => "Polished",
};
const ONBOARDING_CONVERSATION = window.KP_ONBOARDING_CONVERSATION || {
  SLOT_IDS: {
    INTRO_CONSENT: "intro_consent",
    VOICE_SETUP: "voice_setup",
    COMMUNICATION_PLATFORMS: "communication_platforms",
    VOICE_PROFILE: "voice_profile",
  },
  createState: () => ({ slots: {}, currentSlot: "intro_consent" }),
  promptForStep: (stepId) => stepId === "intro"
    ? {
      slotId: "intro_consent",
      question: "Would you like a guided intro, or a voice-guided intro?",
      helper: "If yes, I will offer voice setup first, then models and integrations.",
      placeholder: "Type yes, guide me, or skip setup.",
      actionLabel: "Use answer",
      progressText: "",
    }
    : stepId === "preferences"
    ? {
      slotId: "voice_profile",
      question: "Describe how Pillar Press should write for you.",
      helper: "Paste a few notes about your voice, audience, tone, and what to avoid. I will turn them into editable settings below.",
      placeholder: "e.g. Clear, useful, direct. I write for independent operators and want drafts that preserve my point of view without hype or jargon.",
      actionLabel: "Save",
      progressText: "",
    }
    : {
      slotId: "communication_platforms",
      question: "What are you working on first?",
      helper: "Name the first project or campaign Pillar Press should organize for you.",
      placeholder: "e.g. Launch plan, book draft, newsletter, or research brief.",
      actionLabel: "Use answer",
      progressText: "",
    },
  captureAnswer: (state) => state || {},
  skipSlot: (state) => state || {},
  metricForAnswer: (slotId, inputMethod) => ({
    stepId: slotId === "voice_profile" ? "preferences" : "focus",
    inputMethod: inputMethod || "typed",
    answerKind: slotId || "setup_answer",
    conversational: true,
    answerAccepted: true,
  }),
};
const ONBOARDING_STEPS = (ONBOARDING_RUNTIME && ONBOARDING_RUNTIME.steps) || [
  { id: "intro", label: "Intro" },
  { id: "voice", label: "Voice" },
  { id: "connect", label: "Connect" },
  { id: "focus", label: "First focus" },
  { id: "preferences", label: "Preferences" },
];
const ONBOARDING_TRUST = (ONBOARDING_RUNTIME && ONBOARDING_RUNTIME.trust) || {
  reassurance: "You're in control. Nothing connects without your approval.",
  footer: "Pillar Press · Your desk for ideas that matter.",
};
const ONBOARDING_FLAGS = (ONBOARDING_RUNTIME && ONBOARDING_RUNTIME.flags) || {
  onboardingCompletePref: "setupHelperCompleteV1",
};
const ONBOARDING_ACTIONS = (ONBOARDING_RUNTIME && ONBOARDING_RUNTIME.ACTION_INTENTS) || {};
const ONBOARDING_ACTION_STATUSES = (ONBOARDING_RUNTIME && ONBOARDING_RUNTIME.ACTION_STATUSES) || {
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SKIPPED: "skipped",
};
const ONBOARDING_METRIC_EVENTS = (ONBOARDING_RUNTIME && ONBOARDING_RUNTIME.METRIC_EVENTS) || {
  STARTED: "onboarding_started",
  STEP_VIEWED: "step_viewed",
  ANSWER_CAPTURED: "answer_captured",
  SKIPPED: "onboarding_skipped",
  COMPLETED: "onboarding_completed",
};

function createSetupSessionId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return "onb-" + window.crypto.randomUUID();
  } catch (_err) {}
  return "onb-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function PillarPressLockup({ compact = false }) {
  return (
    <div className={compact ? "kp-brand-lockup kp-brand-lockup-compact" : "kp-brand-lockup"} aria-label="Pillar Press">
      <img className="kp-brand-lockup-icon" src="brand/pillar-press-product-mark.png" alt="" />
      <strong className="kp-brand-lockup-wordmark">
        <span>PILLAR</span>
        <em>Press</em>
      </strong>
    </div>
  );
}

function OnboardingBrand() {
  return (
    <div className="kp-onboarding-brand-row">
      <PillarPressLockup />
    </div>
  );
}

function PillarPressChatAvatar() {
  return (
    <span className="kp-chat-avatar" aria-hidden="true">
      <img src="brand/pillar-press-product-mark.png" alt="" />
    </span>
  );
}

function SetupHostPanel({ conversation, setupError }) {
  return (
    <aside className="kp-host-panel" aria-label="Setup conversation">
      <div className="kp-host-heading">
        <div>
          <PillarPressLockup compact />
          <div className="kp-host-kicker">Setup Guide</div>
          <h2>{conversation.label}</h2>
        </div>
      </div>
      <div className="kp-host-messages">
        {(conversation.messages || []).map((message, index) => (
          <p key={index}>{message}</p>
        ))}
      </div>
      {setupError && <p className="kp-host-error" role="alert">{setupError}</p>}
    </aside>
  );
}

function SetupConversationCanvas({ children, conversation, setupError, conversationState }) {
  const slotPrompts = (ONBOARDING_CONVERSATION && ONBOARDING_CONVERSATION.slotPrompts) || {};
  const sequence = (ONBOARDING_CONVERSATION && ONBOARDING_CONVERSATION.QUESTION_SEQUENCE) || [];
  const slots = (conversationState && conversationState.slots) || {};
  const currentPrompt = conversation && ONBOARDING_CONVERSATION && ONBOARDING_CONVERSATION.promptForStep
    ? ONBOARDING_CONVERSATION.promptForStep(conversation.id, conversationState)
    : null;
  const answeredTurns = sequence
    .map((slotId) => {
      const slot = slots[slotId];
      const prompt = slotPrompts[slotId];
      if (!slot || !prompt || (slot.status !== "answered" && slot.status !== "skipped")) return null;
      return {
        id: slotId,
        prompt,
        slot,
        text: slot.status === "skipped" ? "I'll skip this for now." : slot.answerPreview,
      };
    })
    .filter(Boolean);
  return (
    <section className="kp-conversation-canvas" aria-label="Pillar Press setup conversation">
      <div className="kp-conversation-toolbar">
        <div className="kp-conversation-host">
          <div className="kp-conversation-state">
            <span>Setup Guide</span>
            <strong>{conversation.label}</strong>
          </div>
        </div>
      </div>
      <div className="kp-conversation-thread">
        {(conversation.messages || []).map((message, index) => (
          <div key={"assistant-" + index} className="kp-chat-turn kp-chat-turn-assistant">
            <PillarPressChatAvatar />
            <p>{message}</p>
          </div>
        ))}
        {answeredTurns.map((turn) => (
          <React.Fragment key={turn.id}>
            <div className="kp-chat-turn kp-chat-turn-assistant">
              <PillarPressChatAvatar />
              <p>{turn.prompt.question}</p>
            </div>
            <div className="kp-chat-turn kp-chat-turn-user">
              <p>{turn.text}</p>
            </div>
          </React.Fragment>
        ))}
        {currentPrompt && currentPrompt.slotStatus !== "answered" && currentPrompt.slotStatus !== "skipped" && (
          <div className="kp-chat-turn kp-chat-turn-assistant">
            <PillarPressChatAvatar />
            <p>{currentPrompt.question}</p>
          </div>
        )}
      </div>
      <div className="kp-conversation-composer">
        {children}
      </div>
      {setupError && (
        <div className="kp-conversation-status" aria-live="polite">
          <strong role="alert">{setupError}</strong>
        </div>
      )}
    </section>
  );
}

function SetupShell({ children, conversation, setupError, centered, conversationState }) {
  return (
    <main className={"kp-setup-shell kp-setup-shell-canvas" + (centered ? " kp-setup-shell-centered" : "")}>
      <SetupConversationCanvas
        conversation={conversation}
        setupError={setupError}
        conversationState={conversationState}
      >
        {children}
      </SetupConversationCanvas>
    </main>
  );
}

function SetupAnswerComposer({
  question,
  helper,
  value,
  onChange,
  onSubmit,
  onListen,
  listening,
  disabled,
  placeholder,
  transcript,
  actionLabel,
  repair,
  onRepairChoose,
  showTranscript = true,
  showRepair = true,
}) {
  return (
    <div className="kp-answer-composer">
      <label>
        <span>{question}</span>
        {helper && <p className="kp-answer-helper">{helper}</p>}
        <textarea
          className="kp-setup-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          placeholder={placeholder || "Type your answer here."}
          disabled={disabled}
        />
      </label>
      {showTranscript && transcript && (
        <p className="kp-transcript-preview" aria-live="polite">I heard: <strong>{transcript}</strong></p>
      )}
      <div className="kp-answer-actions">
        <button className="kp-setup-outline" type="button" onClick={onListen} disabled={disabled && !listening} aria-pressed={listening ? "true" : "false"}>
          <Icon name="mic" size={16} /> {listening ? "Stop listening" : "Speak answer"}
        </button>
        <button className="kp-setup-primary" type="button" onClick={onSubmit} disabled={disabled || !String(value || "").trim()}>
          {actionLabel || "Use answer"} <Icon name="arrowR" size={20} />
        </button>
      </div>
      {showRepair && <SetupRepairChoices repair={repair} onChoose={onRepairChoose} />}
    </div>
  );
}

function SetupRepairChoices({ repair, onChoose }) {
  if (!repair || !repair.needsRepair) return null;
  const suggestions = Array.isArray(repair.suggestions) ? repair.suggestions : [];
  return (
    <div className="kp-repair-box" role="status" aria-live="polite">
      <p>{repair.message || "I am not sure what you meant. Choose one of these, or type a clearer answer."}</p>
      {!!suggestions.length && (
        <div className="kp-repair-actions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.label}
              className="kp-setup-outline"
              type="button"
              onClick={() => onChoose(suggestion)}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SetupProfileReview({ profile }) {
  if (!profile) return null;
  const platforms = (profile.communicationPlatforms || []).map((item) => item.platform).filter(Boolean);
  const outputs = (profile.publicationDefaults && profile.publicationDefaults.defaultOutputTypes) || [];
  const permissions = profile.permissions || {};
  const permissionText = [
    permissions.mayUseSavedMemory ? "Memory approved" : "Memory off",
    permissions.mayUseWebResearch ? "Web research approved" : "Web research off",
    permissions.mayPublishOrSend ? "Publish/send approved" : "Publish/send off",
  ];
  return (
    <section className="kp-profile-review" aria-label="Setup profile review">
      <div>
        <p className="kp-profile-eyebrow">Here is what I understood</p>
        <h2>Review before saving</h2>
        <p>Nothing has been saved yet. Edit the fields below before you finish setup.</p>
      </div>
      <div className="kp-profile-grid">
        <div>
          <span>Communicates mostly on</span>
          <strong>{platforms.length ? platforms.join(", ") : "Not set yet"}</strong>
        </div>
        <div>
          <span>Default formats</span>
          <strong>{outputs.length ? outputs.map((item) => item.replace(/_/g, " ")).join(", ") : "Custom"}</strong>
        </div>
        <div>
          <span>Draft approach</span>
          <strong>{ONBOARDING_PROFILE.draftStyleForProfile(profile)}</strong>
        </div>
        <div>
          <span>Permissions</span>
          <strong>{permissionText.join(" · ")}</strong>
        </div>
      </div>
    </section>
  );
}

function SetupStatusChip({ label }) {
  return (
    <span style={{
      minHeight: 34, display: "inline-flex", alignItems: "center", gap: 9,
      border: "1px solid #D8CEC3", borderRadius: 10, padding: "5px 12px",
      color: "#766A63", background: "rgba(255, 252, 246, 0.75)",
      fontSize: 14.5, whiteSpace: "nowrap",
    }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: "#766A63" }} />
      {label}
    </span>
  );
}

function InlineModelSetup({ status, onSaved }) {
  const desktop = window.KINGS_DESKTOP;
  const hasDesktop = !!(desktop && desktop.isDesktop && desktop.isDesktop());
  const [mode, setMode] = React.useState("cloud");
  const [provider, setProvider] = React.useState((status && status.provider && status.provider !== "ollama") ? status.provider : "openai");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [model, setModel] = React.useState((status && status.model) || "gpt-5.2");
  const [listedModels, setListedModels] = React.useState([]);
  const [ollamaStatus, setOllamaStatus] = React.useState(null);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const cloudProviderOptions = [
    { id: "openai", name: "OpenAI", label: "Default: gpt-5.2", logoSrc: "/brand/providers/openai.svg", description: "Strong default for drafting, utility work, and voice setup reuse." },
    { id: "anthropic", name: "Anthropic", label: "Default: claude-haiku-4-5", logoSrc: "/brand/providers/anthropic.svg", description: "Useful for careful long-form writing, review, and structured reasoning." },
    { id: "gemini", name: "Gemini", label: "Default: gemini-3.5-flash", logoSrc: "/brand/providers/gemini.svg", description: "Good for fast multimodal and broad-context workflows." },
    { id: "xai", name: "xAI", label: "Default: grok-4.3", logoSrc: "/brand/providers/xai.svg", description: "Use if your team already works with xAI/Grok API keys." },
    { id: "openai-compatible", name: "Compatible", label: "Custom endpoint", logoSrc: "/brand/providers/api.svg", description: "Use another OpenAI-compatible cloud endpoint with its own base URL." },
  ];
  const localProviderOptions = [
    { id: "ollama", name: "Ollama", label: "Local models", logoSrc: "/brand/providers/ollama.svg", description: "Run models on this Mac through Ollama." },
    { id: "docker", name: "Docker Model Runner", label: "Local endpoint", logoSrc: "/brand/providers/docker.svg", description: "Use Docker's OpenAI-compatible local model endpoint." },
  ];
  const preferredCloudModels = {
    openai: ["gpt-5.2", "gpt-5.2-mini", "gpt-5.1", "gpt-5.1-mini", "gpt-4.1-mini", "gpt-4o-mini"],
    anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-opus-4-8"],
    gemini: ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
    xai: ["grok-4.3", "grok-build-0.1"],
    "openai-compatible": ["local-model"],
  };
  const ollamaModels = ["llama3.2", "mistral", "qwen2.5:7b", "gemma3:4b"];
  const dockerUrl = "http://localhost:12434/engines/v1";

  const providerLabel = (value) => ({
    openai: "OpenAI / ChatGPT",
    anthropic: "Anthropic",
    gemini: "Gemini",
    xai: "xAI / Grok",
    ollama: "Ollama",
    "openai-compatible": "OpenAI-compatible",
  }[value] || value || "Provider");
  const providerBaseUrl = (value) => ({
    openai: "https://api.openai.com/v1",
    xai: "https://api.x.ai/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    anthropic: "https://api.anthropic.com/v1",
  }[value] || "");
  const savedProfileFor = (value) => {
    const profiles = status && Array.isArray(status.profiles) ? status.profiles : [];
    const profile = profiles.find((item) => item && item.provider === value && item.hasApiKey);
    if (profile) return profile;
    if (status && status.provider === value && status.model && status.hasApiKey === true) {
      return {
        id: status.defaultProfileId || "saved-" + value,
        provider: value,
        model: status.model,
        baseUrl: status.baseUrl || null,
        hasApiKey: true,
      };
    }
    return null;
  };
  const savedProviderProfile = savedProfileFor(provider);
  const canUseSavedCloudKey = mode === "cloud" && !!savedProviderProfile && !apiKey.trim();
  const savedKeyMask = "••••••••••••••••";
  const profileIdFor = (profile) =>
    String([profile.provider, profile.baseUrl || "", profile.model].join("-"))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "llm-profile";

  function defaultModelFor(value) {
    return (preferredCloudModels[value] && preferredCloudModels[value][0]) || "";
  }

  function isUsableCloudModel(value, candidate) {
    const id = String(candidate || "").trim().toLowerCase();
    if (!id) return false;
    const blockedParts = [
      "audio",
      "babbage",
      "clip",
      "dall-e",
      "davinci",
      "embedding",
      "embed",
      "image",
      "imagen",
      "moderation",
      "music",
      "nano-banana",
      "realtime",
      "speech",
      "transcribe",
      "translation",
      "tts",
      "veo",
      "video",
      "whisper",
    ];
    if (blockedParts.some((part) => id.includes(part))) return false;
    if (value === "openai") return id.startsWith("gpt-") || /^o\d/.test(id);
    if (value === "anthropic") return id.includes("claude");
    if (value === "gemini") return id.includes("gemini") && !id.includes("live");
    if (value === "xai") return id.includes("grok");
    return true;
  }

  function modelOptionsFor(value, detectedModels) {
    const preferred = preferredCloudModels[value] || [];
    const detected = Array.from(new Set((detectedModels || []).map((item) => String(item || "").trim()).filter(Boolean)))
      .filter((item) => isUsableCloudModel(value, item));
    return Array.from(new Set(preferred.concat(detected)));
  }

  React.useEffect(() => {
    if (!hasDesktop || !desktop.ollamaStatus) return;
    desktop.ollamaStatus().then(setOllamaStatus).catch(() => setOllamaStatus(null));
  }, [hasDesktop]);

  React.useEffect(() => {
    if (!status || apiKey.trim()) return;
    const nextProvider = status.provider && status.provider !== "ollama" ? status.provider : "";
    if (nextProvider && nextProvider !== provider) {
      setProvider(nextProvider);
      setMode("cloud");
      const savedProfile = savedProfileFor(nextProvider);
      setBaseUrl(savedProfile && savedProfile.baseUrl ? savedProfile.baseUrl : "");
      setModel(status.model || (savedProfile && savedProfile.model) || defaultModelFor(nextProvider));
      setListedModels([]);
    } else if (status.model && !model) {
      setModel(status.model);
    }
  }, [status && status.provider, status && status.model]);

  React.useEffect(() => {
    if (mode !== "cloud") return undefined;
    const trimmedKey = apiKey.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const savedProfile = savedProfileFor(provider);
    const hasUsableKey = !!trimmedKey || !!savedProfile;
    const hasUsableBaseUrl = provider !== "openai-compatible" || !!trimmedBaseUrl || !!(savedProfile && savedProfile.baseUrl);
    if (!hasUsableKey || !hasUsableBaseUrl) {
      setListedModels([]);
      setModel((savedProfile && savedProfile.model) || defaultModelFor(provider));
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadModels({ quiet: true });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [mode, provider, apiKey, baseUrl]);

  function applyMode(nextMode) {
    setMode(nextMode);
    setMessage("");
    setListedModels([]);
    if (nextMode === "ollama") {
      setProvider("ollama");
      setModel("llama3.2");
      return;
    }
    if (nextMode === "docker") {
      setProvider("openai-compatible");
      setBaseUrl(dockerUrl);
      setModel("ai/qwen3:latest");
      return;
    }
    setProvider("openai");
    setBaseUrl("");
    setModel(defaultModelFor("openai"));
  }

  function currentConfig() {
    if (mode === "ollama") return { provider: "ollama", model: model.trim(), baseUrl: "http://127.0.0.1:11434" };
    if (mode === "docker") return { provider: "openai-compatible", model: model.trim(), baseUrl: baseUrl.trim() || dockerUrl };
    const savedProfile = savedProfileFor(provider);
    return {
      provider,
      model: model.trim(),
      apiKey: apiKey.trim() || undefined,
      baseUrl: provider === "openai-compatible" ? (baseUrl.trim() || (savedProfile && savedProfile.baseUrl) || "") : providerBaseUrl(provider),
    };
  }

  async function loadModels(options = {}) {
    const config = currentConfig();
    setBusy(true);
    if (!options.quiet) setMessage("Looking for models.");
    try {
      if (config.provider === "openai-compatible" && !config.baseUrl) throw new Error("Add a base URL first.");
      if (["openai", "anthropic", "gemini", "xai"].includes(config.provider) && !config.apiKey && !savedProfileFor(config.provider)) throw new Error("Paste an API key first.");
      const response = await fetch("/api/llm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(config),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body && body.error) || "Could not load models.");
      const rawModels = body && Array.isArray(body.models) ? body.models : [];
      const models = modelOptionsFor(config.provider, rawModels);
      setListedModels(models);
      const fallback = defaultModelFor(config.provider);
      setModel(models.includes(fallback) ? fallback : (models[0] || fallback));
      setMessage(models.length ? "Models loaded." : "Provider responded, but no models were listed.");
    } catch (error) {
      setListedModels([]);
      setModel(defaultModelFor(config.provider));
      setMessage((error && error.message) || "Could not load models.");
    } finally {
      setBusy(false);
    }
  }

  async function pullModel() {
    if (!hasDesktop || !desktop.pullOllamaModel) {
      setMessage("Open the desktop app to pull Ollama models.");
      return;
    }
    setBusy(true);
    setMessage("Pulling " + model + ". This can take a while.");
    try {
      await desktop.pullOllamaModel(model.trim());
      setMessage("Model is ready.");
    } catch (error) {
      setMessage((error && error.message) || "Could not pull the model.");
    } finally {
      setBusy(false);
    }
  }

  async function saveModel() {
    const config = currentConfig();
    if (!config.model) {
      setMessage("Choose or type a model first.");
      return;
    }
    if (["openai", "anthropic", "gemini", "xai"].includes(config.provider) && !config.apiKey && !savedProfileFor(config.provider)) {
      setMessage("Paste an API key first.");
      return;
    }
    if (config.provider === "openai-compatible" && !config.baseUrl) {
      setMessage("Add a base URL first.");
      return;
    }
    if (!hasDesktop || !desktop.saveLLMSettings) {
      setMessage("Model settings can be saved from the desktop app. You can still test this provider here.");
      return;
    }
    setBusy(true);
    setMessage("Testing model.");
    try {
      const response = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(config),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body && body.error) || "The model test failed.");
      setMessage("Saving model settings.");
      const profile = Object.assign({}, config);
      profile.id = profileIdFor(profile);
      profile.label = providerLabel(profile.provider) + " " + profile.model;
      profile.hasApiKey = !!profile.apiKey || !!savedProfileFor(profile.provider);
      const taskDefaults = Object.fromEntries(["gather", "weave", "draft", "review", "revision", "outputs", "utility", "mediaPrompt", "file"].map((task) => [task, profile.id]));
      const settings = {
        provider: profile.provider,
        model: profile.model,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        profiles: [profile],
        defaultProfileId: profile.id,
        taskDefaults,
      };
      await desktop.saveLLMSettings(settings);
      setMessage("Model saved.");
      if (onSaved) onSaved(profile);
      if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.notifyProviderSetupSaved) {
        window.KP_ONBOARDING_ACTIONS.notifyProviderSetupSaved({ profile });
      }
    } catch (error) {
      setMessage((error && error.message) || "Could not save the model.");
    } finally {
      setBusy(false);
    }
  }

  const source = mode === "cloud" ? "cloud" : "local";
  const savedModelOptions = savedProviderProfile
    ? modelOptionsFor(provider, [savedProviderProfile.model || status && status.model].filter(Boolean))
    : [];
  const options = mode === "ollama" ? ollamaModels : (mode === "cloud" ? (listedModels.length ? listedModels : savedModelOptions) : (preferredCloudModels[provider] || []));
  const cloudKeyReady = mode === "cloud" && (!!apiKey.trim() || !!savedProviderProfile) && (provider !== "openai-compatible" || !!baseUrl.trim() || !!(savedProviderProfile && savedProviderProfile.baseUrl));
  const canChooseCloudModel = mode !== "cloud" || cloudKeyReady;

  return (
    <div className="kp-inline-model-setup">
      <div className="kp-inline-model-head">
        <span aria-hidden="true" className="kp-inline-model-icon"><Icon name="db" size={31} /></span>
        <div>
          <h3>AI & models</h3>
          <p>Choose the models Pillar Press can use to think and create.</p>
        </div>
      </div>
      <div className="kp-inline-model-tabs" role="group" aria-label="Model source">
        <button type="button" className={source === "cloud" ? "active" : ""} onClick={() => applyMode("cloud")}>Cloud</button>
        <button type="button" className={source === "local" ? "active" : ""} onClick={() => applyMode("ollama")}>Local</button>
      </div>
      {source === "cloud" && (
        <div className="kp-provider-card-grid" role="radiogroup" aria-label="Cloud model provider">
          {cloudProviderOptions.map((option) => (
            <button
              key={option.id}
              className="kp-provider-card"
              type="button"
              data-active={provider === option.id ? "true" : "false"}
              aria-checked={provider === option.id ? "true" : "false"}
              role="radio"
              onClick={() => {
                setMode("cloud");
                setProvider(option.id);
                const savedProfile = savedProfileFor(option.id);
                setBaseUrl(option.id === "openai-compatible" ? ((savedProfile && savedProfile.baseUrl) || baseUrl) : "");
                setListedModels([]);
                setModel((savedProfile && savedProfile.model) || defaultModelFor(option.id));
                setMessage("");
              }}
            >
              <span className={"kp-provider-logo kp-provider-logo-" + option.id} aria-hidden="true">
                <img src={option.logoSrc} alt="" />
              </span>
              <span className="kp-provider-card-copy">
                <strong>{option.name}</strong>
                <em>{option.label}</em>
                <span>{option.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {source === "local" && (
        <div className="kp-provider-card-grid" role="radiogroup" aria-label="Local model provider">
          {localProviderOptions.map((option) => (
            <button
              key={option.id}
              className="kp-provider-card"
              type="button"
              data-active={(option.id === "ollama" && mode === "ollama") || (option.id === "docker" && mode === "docker") ? "true" : "false"}
              aria-checked={(option.id === "ollama" && mode === "ollama") || (option.id === "docker" && mode === "docker") ? "true" : "false"}
              role="radio"
              onClick={() => applyMode(option.id)}
            >
              <span className={"kp-provider-logo kp-provider-logo-" + option.id} aria-hidden="true">
                <img src={option.logoSrc} alt="" />
              </span>
              <span className="kp-provider-card-copy">
                <strong>{option.name}</strong>
                <em>{option.label}</em>
                <span>{option.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="kp-inline-model-fields">
        {mode === "cloud" && (
          <>
            <label>
              <span>{providerLabel(provider)} API key</span>
              <input
                className="kp-setup-input"
                type="password"
                value={apiKey || (canUseSavedCloudKey ? savedKeyMask : "")}
                onChange={(event) => setApiKey(event.target.value.replace(/•/g, ""))}
                placeholder={canUseSavedCloudKey ? "Saved key will be used" : "Paste your API key"}
              />
              {canUseSavedCloudKey && (
                <span className="kp-inline-step-label" style={{ marginTop: 6, display: "block" }}>Saved key already configured</span>
              )}
            </label>
          </>
        )}
        {(mode === "docker" || provider === "openai-compatible") && (
          <label className="kp-inline-model-wide">
            <span>Base URL</span>
            <input className="kp-setup-input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={mode === "docker" ? dockerUrl : "https://provider.example/v1"} />
          </label>
        )}
        {mode === "ollama" && (
          <div className="kp-inline-model-local">
            <strong>{ollamaStatus && ollamaStatus.running ? "Ollama is running" : "Ollama local model"}</strong>
            <span>{hasDesktop ? "Use an existing local model or pull one below." : "Use the desktop app to start or pull local models."}</span>
          </div>
        )}
        <label>
          <span>Model</span>
          {mode === "cloud" ? (
            <select className="kp-setup-input" value={model} onChange={(event) => setModel(event.target.value)} disabled={!canChooseCloudModel}>
              <option value="">{cloudKeyReady ? (busy ? "Detecting models..." : "Select a detected model") : "Paste an API key to detect models"}</option>
              {options.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          ) : (
            <>
              <input className="kp-setup-input" value={model} onChange={(event) => setModel(event.target.value)} list="kp-inline-model-options" placeholder="model name" />
              <datalist id="kp-inline-model-options">{options.map((item) => <option key={item} value={item} />)}</datalist>
            </>
          )}
        </label>
      </div>
      <div className="kp-inline-model-actions">
        {mode === "ollama" && <button className="kp-setup-outline" type="button" disabled={busy || !model.trim()} onClick={pullModel}>Pull</button>}
        <button className="kp-setup-primary" type="button" disabled={busy || !model.trim()} onClick={saveModel}>{busy ? "Working..." : "Use model"}</button>
      </div>
      {message && <p className="kp-inline-model-message" role="status">{message}</p>}
    </div>
  );
}

function IntroConsentSetup({ answered, onAccept, onSkip, value, onChange, onSubmit, onListen, listening, transcript, repair, onRepairChoose }) {
  if (answered) return null;
  return (
    <div className="kp-inline-intro-consent">
      <label className="kp-inline-intro-answer">
        <span className="sr-only">Answer the guided intro question</span>
        <textarea
          className="kp-setup-input"
          value={value || ""}
          onChange={(event) => onChange(event.target.value)}
          rows={2}
          placeholder="Type yes, guide me, voice-guided intro, or skip setup."
        />
        {transcript && (
          <p className="kp-transcript-preview" aria-live="polite">I heard: <strong>{transcript}</strong></p>
        )}
      </label>
      <div className="kp-inline-intro-actions">
        <button className="kp-setup-primary" type="button" onClick={onAccept}>Yes, guide me</button>
        <button className="kp-setup-outline" type="button" onClick={onListen} aria-pressed={listening ? "true" : "false"}>
          <Icon name="mic" size={16} /> {listening ? "Stop listening" : "Speak answer"}
        </button>
        <button className="kp-setup-outline" type="button" onClick={onSubmit} disabled={!String(value || "").trim()}>Use answer</button>
        <button className="kp-setup-outline" type="button" onClick={onSkip}>Skip setup</button>
      </div>
      <SetupRepairChoices repair={repair} onChoose={onRepairChoose} />
    </div>
  );
}

function InlineVoiceSetup({ status, audioState, onConnect, onLLMSaved, onVoiceConfigured }) {
  const desktop = window.KINGS_DESKTOP;
  const hasDesktop = !!(desktop && desktop.isDesktop && desktop.isDesktop());
  const [provider, setProvider] = React.useState("openai");
  const [apiKey, setApiKey] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const connected = audioState === "audio_ready";
  const voiceBusy = audioState === "requesting_microphone" || audioState === "listening" || audioState === "transcribing";
  const hasSavedOpenAIKey = !!(
    status && (
      (Array.isArray(status.profiles) && status.profiles.some((profile) => profile && profile.provider === "openai" && profile.hasApiKey)) ||
      (status.provider === "openai" && status.model && status.hasApiKey === true)
    )
  );
  const canUseSavedOpenAI = provider === "openai" && hasSavedOpenAIKey && !apiKey.trim();
  const savedKeyMask = "••••••••••••••••";
  const providerLabels = {
    openai: "OpenAI",
    elevenlabs: "ElevenLabs",
  };
  const providerOptions = [
    {
      id: "openai",
      name: "OpenAI",
      label: "Voice + setup LLM",
      logoSrc: "/brand/providers/openai.svg",
      description: "Best first choice. Reuses the same key for setup, drafting, and read-aloud.",
    },
    {
      id: "elevenlabs",
      name: "ElevenLabs",
      label: "Polished TTS",
      logoSrc: "/brand/providers/elevenlabs.svg",
      description: "Use for higher-quality read-aloud voices after core setup is finished.",
    },
  ];
  const helpCopy = {
    openai: {
      title: "Get an OpenAI API key",
      steps: [
        "Open the OpenAI API keys page and sign in.",
        "Click Create new secret key, name it Pillar Press, and copy the key once it appears.",
        "Open Billing in the OpenAI dashboard and add payment credits if the account has no available balance.",
      ],
      url: "https://platform.openai.com/api-keys",
      billingUrl: "https://platform.openai.com/settings/organization/billing/overview",
    },
    elevenlabs: {
      title: "Get an ElevenLabs API key",
      steps: [
        "Open ElevenLabs API Keys from your account settings.",
        "Create or copy an API key and paste it here.",
        "Make sure your ElevenLabs account has enough character credits for text-to-speech.",
      ],
      url: "https://elevenlabs.io/app/settings/api-keys",
      billingUrl: "https://elevenlabs.io/app/billing",
    },
    hedra: {
      title: "Get a Hedra API key",
      steps: [
        "Open Hedra, sign in, and go to the developer or API settings area.",
        "Create an API key for Pillar Press and copy it into this field.",
        "Add credits or upgrade your Hedra plan if video/avatar generation is not enabled on the account.",
      ],
      url: "https://www.hedra.com/",
      billingUrl: "https://www.hedra.com/",
    },
  };

  const profileIdFor = (profile) =>
    String([profile.provider, profile.baseUrl || "", profile.model].join("-"))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "llm-profile";

  async function saveOpenAIAsStarterLLM() {
    if (!hasDesktop || !desktop.saveLLMSettings) {
      setMessage("OpenAI key works. Open the desktop app to save it as your starter model.");
      return;
    }
    const profile = {
      id: "openai-starter-gpt-5-2",
      label: "OpenAI / ChatGPT gpt-5.2",
      provider: "openai",
      model: "gpt-5.2",
      baseUrl: "https://api.openai.com/v1",
      apiKey: apiKey.trim(),
    };
    profile.id = profileIdFor(profile);
    const taskDefaults = Object.fromEntries(["gather", "weave", "draft", "review", "revision", "outputs", "utility", "mediaPrompt", "file"].map((task) => [task, profile.id]));
    await desktop.saveLLMSettings({
      provider: profile.provider,
      model: profile.model,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      profiles: [profile],
      defaultProfileId: profile.id,
      taskDefaults,
    });
    if (onLLMSaved) onLLMSaved(profile);
    if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.notifyProviderSetupSaved) {
      window.KP_ONBOARDING_ACTIONS.notifyProviderSetupSaved({ profile });
    }
  }

  async function saveVoiceProviderKey() {
    if (!hasDesktop || !desktop.saveMediaProviderKey) return false;
    const desktopProvider = provider === "elevenlabs" ? "elevenlabs" : provider === "hedra" ? "hedra" : "openai";
    await desktop.saveMediaProviderKey(desktopProvider, apiKey.trim(), {
      baseUrl: provider === "openai" ? "https://api.openai.com/v1" : undefined,
    });
    return true;
  }

  async function verifyVoiceKey() {
    setMessage("Checking " + providerLabels[provider] + ".");
    try {
      let response;
      if (provider === "openai") {
        response = await fetch("/api/llm/test", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            provider: "openai",
            model: "gpt-5.2",
            apiKey: apiKey.trim() || undefined,
          }),
        });
      } else if (provider === "hedra") {
        response = await fetch("/api/hedra/credits", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        });
      } else {
        response = await fetch("/api/eleven/voices", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        });
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body && body.error) || "Could not reach " + providerLabels[provider] + ".");
      if (provider === "openai") {
        if (apiKey.trim()) {
          await saveOpenAIAsStarterLLM();
          await saveVoiceProviderKey();
        }
        if (onVoiceConfigured) onVoiceConfigured({ provider, method: "api_key", saved: true });
        setMessage(apiKey.trim()
          ? "OpenAI key works. I saved it encrypted for voice, setup, and drafting."
          : "Saved OpenAI key works. I will use it for voice and drafting.");
        return true;
      } else if (provider === "hedra") {
        const saved = await saveVoiceProviderKey();
        if (onVoiceConfigured) onVoiceConfigured({ provider, method: "api_key", saved });
        setMessage(saved ? "Hedra key works and was saved encrypted for Studio." : "Hedra key works. Open the desktop app to save it for Studio.");
        return true;
      } else {
        const count = body && Array.isArray(body.voices) ? body.voices.length : 0;
        const saved = await saveVoiceProviderKey();
        if (onVoiceConfigured) onVoiceConfigured({ provider, method: "api_key", saved, voices: count });
        setMessage(saved
          ? "ElevenLabs key works and was saved encrypted. " + count + " voices available."
          : count ? "ElevenLabs key works. " + count + " voices available." : "ElevenLabs key works, but no voices were returned.");
        return true;
      }
    } catch (error) {
      setMessage((error && error.message) || "Could not test this key.");
      return false;
    }
  }

  async function saveVoiceSetup() {
    setBusy(true);
    try {
      const verified = await verifyVoiceKey();
      if (!verified) return;
      if (onConnect) await onConnect();
    } finally {
      setBusy(false);
    }
  }

  async function openProviderUrl(url) {
    const cleanUrl = String(url || "").trim();
    if (!cleanUrl) return;
    const desktopBridge = window.KINGS_DESKTOP;
    if (desktopBridge && desktopBridge.isDesktop && desktopBridge.isDesktop() && desktopBridge.openExternalUrl) {
      try {
        await desktopBridge.openExternalUrl(cleanUrl);
        return;
      } catch (error) {
        setMessage((error && error.message) || "Could not open that link. Copy and paste it into your browser.");
      }
    }
    try {
      const opened = window.open(cleanUrl, "_blank", "noopener,noreferrer");
      if (!opened) setMessage("Could not open that link. Copy and paste it into your browser: " + cleanUrl);
    } catch (_err) {
      setMessage("Could not open that link. Copy and paste it into your browser: " + cleanUrl);
    }
  }

  return (
    <div className="kp-inline-voice-setup">
      <div className="kp-inline-voice-head">
        <span aria-hidden="true" className="kp-inline-model-icon"><Icon name="mic" size={25} /></span>
        <div>
          <p className="kp-inline-step-label">Optional voice</p>
          <h3>Add voice if you want me to read aloud</h3>
          <p>Paste a voice API key and I can respond over audio. OpenAI is the easiest first key because it can also power the rest of setup.</p>
        </div>
        <SetupStatusChip label={connected ? "Connected" : "Optional"} />
      </div>
      <div className="kp-inline-voice-controls">
        <div className="kp-provider-card-grid" role="radiogroup" aria-label="Voice provider">
          {providerOptions.map((option) => (
            <button
              key={option.id}
              className="kp-provider-card"
              type="button"
              data-active={provider === option.id ? "true" : "false"}
              aria-checked={provider === option.id ? "true" : "false"}
              role="radio"
              onClick={() => {
                setProvider(option.id);
                setMessage("");
              }}
            >
              <span className={"kp-provider-logo kp-provider-logo-" + option.id} aria-hidden="true">
                <img src={option.logoSrc} alt="" />
              </span>
              <span className="kp-provider-card-copy">
                <strong>{option.name}</strong>
                <em>{option.label}</em>
                <span>{option.description}</span>
              </span>
            </button>
          ))}
        </div>
        <label>
          <span className="kp-api-key-label">
            {providerLabels[provider]} API key
            <button className="kp-api-key-help-toggle" type="button" onClick={() => setHelpOpen((value) => !value)} aria-expanded={helpOpen ? "true" : "false"}>
              <span aria-hidden="true">i</span>
              How do I get my API key?
            </button>
          </span>
          <input
            className="kp-setup-input"
            type="password"
            value={apiKey || (canUseSavedOpenAI ? savedKeyMask : "")}
            onChange={(event) => setApiKey(event.target.value.replace(/•/g, ""))}
            placeholder={canUseSavedOpenAI ? "Saved OpenAI key will be used" : "Paste your API key"}
          />
          {canUseSavedOpenAI && (
            <span className="kp-inline-step-label" style={{ marginTop: 6, display: "block" }}>OpenAI key already saved</span>
          )}
        </label>
        <div className="kp-inline-voice-actions">
          <button className="kp-setup-primary kp-inline-voice-save" type="button" disabled={busy || voiceBusy || (!apiKey.trim() && !canUseSavedOpenAI)} onClick={saveVoiceSetup}>
            {busy || voiceBusy ? <Spinner size={16} /> : null}
            {busy ? "Saving" : audioState === "requesting_microphone" ? "Connecting mic" : "Save"}
          </button>
        </div>
      </div>
      {helpOpen && (
        <div className="kp-inline-provider-help">
          <strong>{helpCopy[provider].title}</strong>
          <ol>
            {helpCopy[provider].steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <div className="kp-inline-provider-links">
            <button type="button" onClick={() => openProviderUrl(helpCopy[provider].url)}>Open API key page</button>
            <button type="button" onClick={() => openProviderUrl(helpCopy[provider].billingUrl)}>Open billing or credits</button>
          </div>
        </div>
      )}
      {message && <p className="kp-inline-model-message" role="status">{message}</p>}
    </div>
  );
}

function SetupPanelRow({ icon, title, description, status, action, onClick, disabled }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "88px minmax(0, 1fr) auto auto", alignItems: "center",
      gap: 24, padding: "42px 46px", borderTop: "1px solid #D8CEC3",
    }}>
      <span aria-hidden="true" style={{
        width: 72, height: 72, borderRadius: 999, display: "grid", placeItems: "center",
        background: "rgba(216, 206, 195, 0.34)", color: "#2A211E",
      }}>
        <Icon name={icon} size={31} />
      </span>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 26, fontWeight: 500, color: "#2A211E" }}>
          {title}
        </h3>
        <p style={{ margin: "11px 0 0", maxWidth: 430, color: "#766A63", fontSize: 18, lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
      <SetupStatusChip label={status} />
      <button className="kp-setup-outline" onClick={onClick} disabled={disabled}>{action}</button>
    </div>
  );
}

function SetupActions({ secondary, onSecondary, primary, onPrimary, disabled, busy }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20,
      marginTop: 42,
    }}>
      <button className="kp-setup-link" onClick={onSecondary}>{secondary}</button>
      <button className="kp-setup-primary" onClick={onPrimary} disabled={disabled || busy}>
        {busy ? <Spinner size={16} /> : null}
        {primary}
        {!busy && <Icon name="arrowR" size={22} />}
      </button>
    </div>
  );
}

function SetupReassurance({ compact }) {
  return (
    <div style={{ marginTop: compact ? 28 : 54, textAlign: "center", color: "#766A63", fontSize: 16 }}>
      <p style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 10 }}>
        <Icon name="key" size={15} /> {ONBOARDING_TRUST.reassurance}
      </p>
      <p style={{ margin: "74px 0 0", opacity: 0.82 }}>{ONBOARDING_TRUST.footer}</p>
    </div>
  );
}

function SetupField({ label, helper, children }) {
  return (
    <label style={{ display: "grid", gap: 8, color: "#2A211E", minWidth: 0 }}>
      <span style={{ fontFamily: "var(--font-serif)", fontSize: 21 }}>{label}</span>
      {helper && <span style={{ color: "#766A63", fontSize: 16, lineHeight: 1.4 }}>{helper}</span>}
      {children}
    </label>
  );
}

function SetupHelper({ open, onClose, onComplete, onOpenProviderSetup, initialStep }) {
  const [step, setStep] = React.useState(ONBOARDING_RUNTIME
    ? ONBOARDING_RUNTIME.clampStepIndex(initialStep || 0)
    : Math.min(initialStep || 0, 3));
  const [providerStatus, setProviderStatus] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [setupError, setSetupError] = React.useState("");
  const [actionResults, setActionResults] = React.useState({});
  const [setupMode, setSetupMode] = React.useState("guided");
  const [audioMuted, setAudioMuted] = React.useState(false);
  const [campaignName, setCampaignName] = React.useState("");
  const [prefDraft, setPrefDraft] = React.useState(null);
  const [draftStyle, setDraftStyle] = React.useState("Polished");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [audioState, setAudioState] = React.useState("audio_not_connected");
  const [audioError, setAudioError] = React.useState("");
  const [introVisible, setIntroVisible] = React.useState(false);
  const [introAnswer, setIntroAnswer] = React.useState("");
  const [setupAnswer, setSetupAnswer] = React.useState("");
  const [setupAnswerInputMethod, setSetupAnswerInputMethod] = React.useState("typed");
  const [setupTranscript, setSetupTranscript] = React.useState("");
  const [listening, setListening] = React.useState(false);
  const [repairState, setRepairState] = React.useState(null);
  const [platformAnswerCaptured, setPlatformAnswerCaptured] = React.useState(false);
  const [profileAnswer, setProfileAnswer] = React.useState("");
  const [setupProfileDraft, setSetupProfileDraft] = React.useState(null);
  const [profileBusy, setProfileBusy] = React.useState(false);
  const [focusActivation, setFocusActivation] = React.useState(null);
  const [conversationState, setConversationStateBase] = React.useState(() => ONBOARDING_CONVERSATION.createState());
  const conversationStateRef = React.useRef(conversationState);
  const setConversationState = React.useCallback((updater) => {
    const current = conversationStateRef.current || ONBOARDING_CONVERSATION.createState();
    const next = typeof updater === "function" ? updater(current) : updater;
    conversationStateRef.current = next;
    setConversationStateBase(next);
  }, []);
  const transcriptHandlerRef = React.useRef(null);
  const listenSessionRef = React.useRef(null);
  const listenTargetRef = React.useRef(null);
  const setupStartedAtRef = React.useRef(Date.now());
  const metricsSessionIdRef = React.useRef(createSetupSessionId());
  const lastStepMetricRef = React.useRef(null);
  const voiceDecisionRef = React.useRef(false);
  const state = window.Store.getState();
  const campaigns = state.campaigns || [];
  const activeCampaign = window.Store.activeCampaign && window.Store.activeCampaign();
  const hasDesktopBridge = !!(window.KINGS_DESKTOP && window.KINGS_DESKTOP.isDesktop && window.KINGS_DESKTOP.isDesktop());
  const introScript = ONBOARDING_COPY.getPressIntroScript("pillar_press");
  const focusSuggestions = "Try something concrete like Launch plan, Book draft, Newsletter, Research brief, or Client proposal.";

  React.useEffect(() => {
    if (!open) return;
    if (ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.providerStatus) {
      ONBOARDING_ACTION_REGISTRY.providerStatus().then((result) => {
        setProviderStatus(result && result.status === ONBOARDING_ACTION_STATUSES.SUCCEEDED ? result.data : null);
      });
      return;
    }
    fetch("/api/llm/status", { headers: { Accept: "application/json" } })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })).catch(() => ({ ok: false, data: null })))
      .then(({ ok, data }) => setProviderStatus(ok ? data : null))
      .catch(() => setProviderStatus(null));
  }, [open]);

  React.useEffect(() => {
    if (!open || !ONBOARDING_ACTION_REGISTRY || !ONBOARDING_ACTION_REGISTRY.onProviderSetupSaved) return undefined;
    return ONBOARDING_ACTION_REGISTRY.onProviderSetupSaved((detail) => {
      const safe = detail || {};
      recordAction(ONBOARDING_ACTIONS.OPEN_PROVIDER_SETUP, ONBOARDING_ACTION_STATUSES.SUCCEEDED, { data: safe });
      setProviderStatus((current) => Object.assign({}, current || {}, {
        provider: safe.provider || (current && current.provider),
        model: safe.model || (current && current.model),
        hasApiKey: safe.hasApiKey !== undefined ? safe.hasApiKey : (current && current.hasApiKey),
        profiles: safe.provider && safe.model
          ? [{
              id: safe.id || (current && current.defaultProfileId) || "saved-" + safe.provider,
              label: safe.label || safe.model,
              provider: safe.provider,
              model: safe.model,
              baseUrl: safe.baseUrl || null,
              hasApiKey: safe.hasApiKey !== false,
            }]
          : current && current.profiles,
      }));
      setSetupError("");
    });
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    setupStartedAtRef.current = Date.now();
    metricsSessionIdRef.current = createSetupSessionId();
    lastStepMetricRef.current = null;
    voiceDecisionRef.current = false;
    setConversationState(ONBOARDING_CONVERSATION.createState());
    setIntroAnswer("");
    setIntroVisible(false);
    setAudioMuted(false);
    recordMetric(ONBOARDING_METRIC_EVENTS.STARTED, { stepId: "intro" });
    const refs = window.Store.activeReferences ? window.Store.activeReferences() : {};
    const throughline = refs.strategy && refs.strategy.throughlines && refs.strategy.throughlines[0];
    const audience = refs.audiences && refs.audiences.list && refs.audiences.list[0];
    setCampaignName(activeCampaign && activeCampaign.name ? activeCampaign.name : "");
    setPrefDraft({
      selfVision: (refs.selfVision && refs.selfVision.body) || "",
      strategy: (refs.strategy && refs.strategy.body) || "",
      throughlineTag: throughline ? throughline.tag || "" : "core",
      throughlineName: throughline ? throughline.name || "" : "",
      throughlineNote: throughline ? throughline.note || "" : "",
      audienceId: audience ? audience.id || "" : "general",
      audienceName: audience ? audience.name || "" : "",
      audienceNote: audience ? audience.note || "" : "",
      registerBody: (refs.registers && refs.registers.body) || "",
      voiceRules: refs.voiceRules && refs.voiceRules.rules ? refs.voiceRules.rules.join("\n") : "",
      redLines: refs.redLines && refs.redLines.rules ? refs.redLines.rules.join("\n") : "",
      gateSpec: (refs.gateSpec && refs.gateSpec.body) || "",
    });
  }, [open, activeCampaign && activeCampaign.id]);

  React.useEffect(() => {
    if (!open) return;
    const stepId = (ONBOARDING_STEPS[step] && ONBOARDING_STEPS[step].id) || "connect";
    if (lastStepMetricRef.current === stepId) return;
    lastStepMetricRef.current = stepId;
    recordMetric(ONBOARDING_METRIC_EVENTS.STEP_VIEWED, { stepId });
  }, [open, step]);

  React.useEffect(() => {
    if (!open) {
      stopListeningSession(false);
      return undefined;
    }
    if (!ONBOARDING_ACTION_REGISTRY || !ONBOARDING_ACTION_REGISTRY.onSttFinal) return undefined;
    let active = true;
    let cleanup = null;
    ONBOARDING_ACTION_REGISTRY.onSttFinal((event) => {
      if (!active) return;
      if (transcriptHandlerRef.current) transcriptHandlerRef.current(event.transcript || "", listenTargetRef.current);
    }).then((unlisten) => {
      cleanup = unlisten;
      if (!active && typeof cleanup === "function") cleanup();
    });
    return () => {
      active = false;
      if (typeof cleanup === "function") cleanup();
      stopListeningSession(false);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open || !ONBOARDING_ACTION_REGISTRY || !ONBOARDING_ACTION_REGISTRY.onVoiceStatus) return undefined;
    let active = true;
    let cleanup = null;
    ONBOARDING_ACTION_REGISTRY.onVoiceStatus((event) => {
      if (!active) return;
      const status = event && event.status;
      if (status === "listening") {
        setAudioState("listening");
        setAudioError("");
        setListening(true);
      } else if (status === "transcribing") {
        setAudioState("transcribing");
        setListening(true);
      } else if (status === "ready") {
        setAudioState("audio_ready");
        setListening(false);
        listenSessionRef.current = null;
        listenTargetRef.current = null;
      } else if (status === "error") {
        setAudioState("error");
        setListening(false);
        listenSessionRef.current = null;
        listenTargetRef.current = null;
        setAudioError((event && event.message) || "Voice transcription failed. You can continue by typing.");
      } else if (status === "stopped") {
        setListening(false);
        listenSessionRef.current = null;
        listenTargetRef.current = null;
      }
    }).then((unlisten) => {
      cleanup = unlisten;
      if (!active && typeof cleanup === "function") cleanup();
    });
    return () => {
      active = false;
      if (typeof cleanup === "function") cleanup();
    };
  }, [open]);

  if (!open) return null;

  const currentStep = ONBOARDING_STEPS[step] || ONBOARDING_STEPS[0];
  const conversation = ONBOARDING_RUNTIME && ONBOARDING_RUNTIME.getStepConversation
    ? ONBOARDING_RUNTIME.getStepConversation(currentStep.id)
    : { id: currentStep.id, label: currentStep.label, messages: [], suggestions: [], motionState: "idle" };
  const focusPrompt = ONBOARDING_CONVERSATION.promptForStep("focus", conversationState);
  const preferencesPrompt = ONBOARDING_CONVERSATION.promptForStep("preferences", conversationState);
  const providerConnected = !!(providerStatus && providerStatus.provider && providerStatus.model);
  const voiceConnected = audioState === "audio_ready";
  const introAccepted = introAnswer === "yes";
  const introSkipped = introAnswer === "skip";
  const introChoiceMade = introAccepted || introSkipped;

  function recordAction(intent, status, payload) {
    if (!intent) return;
    const result = ONBOARDING_RUNTIME
      ? ONBOARDING_RUNTIME.normalizeActionResult(intent, Object.assign({ status }, payload || {}))
      : Object.assign({ intent, status, updatedAt: Date.now() }, payload || {});
    setActionResults((current) => Object.assign({}, current, { [intent]: result }));
  }

  function goToStep(next) {
    setSetupError("");
    setSetupTranscript("");
    setRepairState(null);
    stopListeningSession();
    setStep(ONBOARDING_RUNTIME ? ONBOARDING_RUNTIME.clampStepIndex(next) : Math.max(0, Math.min(4, next)));
  }

  function recordMetric(type, payload) {
    if (!ONBOARDING_ACTION_REGISTRY || !ONBOARDING_ACTION_REGISTRY.recordMetric) return;
    ONBOARDING_ACTION_REGISTRY.recordMetric(type, Object.assign({
      sessionId: metricsSessionIdRef.current,
      durationMs: Date.now() - setupStartedAtRef.current,
    }, payload || {}));
  }

  function repairMessageFor(slotId, stepId, repair) {
    const prompt = ONBOARDING_CONVERSATION.promptForStep(stepId, conversationState);
    if (repair && repair.intent === "repeat" && prompt) return prompt.question;
    if (repair && repair.intent === "help" && prompt) return prompt.helper || prompt.question;
    return repair && repair.message;
  }

  function showRepair(slotId, stepId, repair) {
    setRepairState(Object.assign({}, repair || {}, {
      slotId,
      needsRepair: true,
      message: repairMessageFor(slotId, stepId, repair) || "I am not sure what you meant. Choose one of these, or type a clearer answer.",
    }));
    setSetupError("");
    recordMetric(ONBOARDING_METRIC_EVENTS.ANSWER_REPAIRED || "answer_repaired", {
      stepId,
      inputMethod: repair && repair.inputMethod,
      answerKind: repair && repair.slotId ? repair.slotId : slotId,
      repairReason: repair && repair.needsRepair ? "unclear_or_repair_intent" : "repair_requested",
      repairIntent: repair && repair.intent,
      conversational: true,
      answerAccepted: false,
    });
  }

  function applyPlatformAnswer(text, inputMethod) {
    const clean = String(text || "").trim();
    if (!clean) return null;
    const slotId = ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS;
    const repair = ONBOARDING_CONVERSATION.repairForAnswer
      ? ONBOARDING_CONVERSATION.repairForAnswer(slotId, clean)
      : null;
    if (repair && (repair.needsRepair || repair.intent === "help" || repair.intent === "repeat")) {
      setSetupAnswer(clean);
      setSetupAnswerInputMethod(inputMethod || "typed");
      setSetupTranscript(clean);
      showRepair(slotId, "focus", repair);
      return { needsRepair: true };
    }
    if (repair && repair.intent === "skip") {
      setSetupAnswer(clean);
      setSetupAnswerInputMethod(inputMethod || "typed");
      setSetupTranscript(clean);
      setRepairState(null);
      setConversationState((current) => ONBOARDING_CONVERSATION.skipSlot(current, slotId));
      recordAction(ONBOARDING_ACTIONS.SKIP_FOCUS, ONBOARDING_ACTION_STATUSES.SKIPPED);
      return { skipped: true };
    }
    setSetupAnswer(clean);
    setSetupAnswerInputMethod(inputMethod || "typed");
    setSetupTranscript(clean);
    setRepairState(null);
    setSetupError("");
    setPlatformAnswerCaptured(true);
    setConversationState((current) => ONBOARDING_CONVERSATION.captureAnswer(
      current,
      slotId,
      clean,
      inputMethod || "typed",
    ));
    const profile = ONBOARDING_PROFILE.buildProfileDraft({
      transcript: clean,
      currentDraft: setupProfileDraft,
    });
    setSetupProfileDraft(profile);
    const platformNames = clean
      .split(/,|\band\b|\n/i)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
    const focusName = ((platformNames[0] || clean) + " focus").trim();
    if (prefDraft) {
      const firstPlatform = platformNames[0] || clean;
      const seededDraft = ONBOARDING_PROFILE.applyProfileToPreferences(profile, prefDraft);
      setPrefDraft(Object.assign({}, seededDraft, {
        audienceNote: prefDraft.audienceNote || ("Communicates most on: " + clean),
        strategy: prefDraft.strategy || ("Primary communication places: " + clean),
        throughlineNote: prefDraft.throughlineNote || ("First setup answer: " + clean),
      }));
      if (!campaignName.trim() && firstPlatform) setCampaignName(focusName);
    } else if (!campaignName.trim()) {
      setCampaignName(focusName || "First focus");
    }
    recordMetric(
      ONBOARDING_METRIC_EVENTS.ANSWER_CAPTURED,
      ONBOARDING_CONVERSATION.metricForAnswer(ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS, inputMethod || "typed"),
    );
    return { focusName };
  }

  function communicationSetupHasDecision(stateInput) {
    const stateToCheck = stateInput || conversationState;
    const slot = stateToCheck && stateToCheck.slots && stateToCheck.slots[ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS];
    return !!(slot && slot.status && slot.status !== "empty");
  }

  function captureFocusNameAsSetupAnswer(answer, inputMethod) {
    const clean = String(answer || "").trim();
    if (!clean || communicationSetupHasDecision()) return;
    setSetupAnswer(clean);
    setSetupAnswerInputMethod(inputMethod || "typed");
    setConversationState((current) => {
      if (communicationSetupHasDecision(current)) return current;
      return ONBOARDING_CONVERSATION.captureAnswer(
        current,
        ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS,
        clean,
        inputMethod || "typed",
      );
    });
    setPlatformAnswerCaptured(true);
    if (!setupProfileDraft) {
      const profile = ONBOARDING_PROFILE.buildProfileDraft({
        transcript: clean,
        currentDraft: setupProfileDraft,
      });
      setSetupProfileDraft(profile);
      if (prefDraft) {
        setPrefDraft(ONBOARDING_PROFILE.applyProfileToPreferences(profile, prefDraft));
      }
    }
    recordMetric(
      ONBOARDING_METRIC_EVENTS.ANSWER_CAPTURED,
      ONBOARDING_CONVERSATION.metricForAnswer(ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS, inputMethod || "typed"),
    );
  }

  function voiceSetupHasDecision(stateInput, includeRef = true) {
    if (includeRef && voiceDecisionRef.current) return true;
    const stateToCheck = stateInput || conversationState;
    const slot = stateToCheck && stateToCheck.slots && stateToCheck.slots[ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_SETUP];
    return !!(slot && slot.status && slot.status !== "empty");
  }

  function captureVoiceSetupAnswer(answer, inputMethod) {
    const clean = String(answer || "").trim();
    if (!clean || voiceSetupHasDecision()) return;
    setRepairState(null);
    setSetupError("");
    voiceDecisionRef.current = true;
    setConversationState((current) => {
      if (voiceSetupHasDecision(current, false)) return current;
      return ONBOARDING_CONVERSATION.captureAnswer(
        current,
        ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_SETUP,
        clean,
        inputMethod || "button",
      );
    });
    recordMetric(
      ONBOARDING_METRIC_EVENTS.ANSWER_CAPTURED,
      ONBOARDING_CONVERSATION.metricForAnswer(ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_SETUP, inputMethod || "button"),
    );
  }

  function skipVoiceSetup() {
    if (voiceSetupHasDecision()) return;
    setRepairState(null);
    setSetupError("");
    voiceDecisionRef.current = true;
    setConversationState((current) => {
      if (voiceSetupHasDecision(current, false)) return current;
      return ONBOARDING_CONVERSATION.skipSlot(current, ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_SETUP);
    });
    recordAction(ONBOARDING_ACTIONS.REQUEST_VOICE, ONBOARDING_ACTION_STATUSES.SKIPPED, {
      data: { reason: "user_skipped_voice" },
    });
  }

  function handleVoiceConfigured(detail) {
    const safe = detail || {};
    const provider = safe.provider ? String(safe.provider) : "voice";
    captureVoiceSetupAnswer(provider + " voice key verified", "button");
    recordAction(ONBOARDING_ACTIONS.REQUEST_VOICE, ONBOARDING_ACTION_STATUSES.SUCCEEDED, {
      data: {
        provider,
        method: safe.method || "api_key",
        saved: !!safe.saved,
      },
    });
  }

  function handleVoiceSetupAnswer(text, inputMethod) {
    const clean = String(text || "").trim();
    if (!clean || voiceSetupHasDecision()) return;
    const slotId = ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_SETUP;
    const repair = ONBOARDING_CONVERSATION.repairForAnswer
      ? ONBOARDING_CONVERSATION.repairForAnswer(slotId, clean)
      : null;
    setSetupTranscript(clean);
    if (repair && (repair.needsRepair || repair.intent === "help" || repair.intent === "repeat")) {
      showRepair(slotId, "voice", repair);
      return;
    }
    if (repair && (repair.intent === "skip" || repair.intent === "deny")) {
      skipVoiceSetup();
      return;
    }
    if (repair && (repair.intent === "affirm" || repair.intent === "voice")) {
      connectAudio();
      return;
    }
    captureVoiceSetupAnswer(clean, inputMethod || "typed");
  }

  function acceptIntroFromConnect() {
    setIntroAnswer("yes");
    setSetupError("");
    setConversationState((current) => ONBOARDING_CONVERSATION.captureAnswer(
      current,
      ONBOARDING_CONVERSATION.SLOT_IDS.INTRO_CONSENT,
      "yes, introduce yourself",
      "button",
    ));
  }

  function skipIntroFromConnect() {
    setIntroAnswer("skip");
    setSetupError("");
    setConversationState((current) => ONBOARDING_CONVERSATION.skipSlot(
      current,
      ONBOARDING_CONVERSATION.SLOT_IDS.INTRO_CONSENT,
    ));
    recordAction(ONBOARDING_ACTIONS.SKIP_INTRO, ONBOARDING_ACTION_STATUSES.SKIPPED);
  }

  function mergeProfileIntoPreferences(profile) {
    if (!profile) return;
    setSetupProfileDraft(profile);
    setDraftStyle(ONBOARDING_PROFILE.draftStyleForProfile(profile));
    setPrefDraft((current) => {
      const seeded = ONBOARDING_PROFILE.applyProfileToPreferences(profile, current || {});
      const selfStatement = profile.selfStatement || (profile.voiceProfile && profile.voiceProfile.userDescription) || profile.sourceTranscript || "";
      const rules = (profile.voiceRules || []).join("\n");
      const redLines = (profile.redLines || []).join("\n");
      const replacePlaceholder = (value) => {
        const clean = String(value || "").trim().toLowerCase();
        return !clean || clean === "first setup focus" || clean === "core insight or point of view" || clean.startsWith("initial setup answer:");
      };
      return Object.assign({}, seeded, {
        selfVision: replacePlaceholder(seeded.selfVision) ? selfStatement : seeded.selfVision,
        audienceName: replacePlaceholder(seeded.audienceName) ? (profile.primaryAudience || seeded.audienceName || "") : seeded.audienceName,
        throughlineName: replacePlaceholder(seeded.throughlineName) ? (profile.throughline || seeded.throughlineName || "") : seeded.throughlineName,
        voiceRules: replacePlaceholder(seeded.voiceRules) ? rules : seeded.voiceRules,
        redLines: replacePlaceholder(seeded.redLines) ? redLines : seeded.redLines,
      });
    });
  }

  async function interpretProfileAnswer(text, inputMethod) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const slotId = ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE;
    const repair = ONBOARDING_CONVERSATION.repairForAnswer
      ? ONBOARDING_CONVERSATION.repairForAnswer(slotId, clean)
      : null;
    if (repair && (repair.needsRepair || repair.intent === "help" || repair.intent === "repeat")) {
      setProfileAnswer(clean);
      setSetupTranscript(clean);
      showRepair(slotId, "preferences", repair);
      return;
    }
    if (repair && repair.intent === "skip") {
      setProfileAnswer(clean);
      setSetupTranscript(clean);
      setRepairState(null);
      setConversationState((current) => ONBOARDING_CONVERSATION.skipSlot(current, slotId));
      recordAction(ONBOARDING_ACTIONS.SAVE_PREFERENCES, ONBOARDING_ACTION_STATUSES.SKIPPED);
      return;
    }
    setProfileAnswer(clean);
    setProfileBusy(true);
    setSetupError("");
    setRepairState(null);
    recordAction(ONBOARDING_ACTIONS.EXTRACT_SETUP_PROFILE, ONBOARDING_ACTION_STATUSES.PENDING);
    try {
      let profile = null;
      if (ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.extractSetupProfile) {
        const result = await ONBOARDING_ACTION_REGISTRY.extractSetupProfile({
          brand: "pillar_press",
          transcript: clean,
          currentDraft: setupProfileDraft,
        });
        if (result.status === ONBOARDING_ACTION_STATUSES.SUCCEEDED && result.data && result.data.profileDraft) {
          profile = Object.assign({ version: "server" }, result.data.profileDraft, { sourceTranscript: clean });
          recordAction(ONBOARDING_ACTIONS.EXTRACT_SETUP_PROFILE, ONBOARDING_ACTION_STATUSES.SUCCEEDED, result);
        }
      }
      if (!profile) {
        profile = ONBOARDING_PROFILE.buildProfileDraft({
          transcript: clean,
          currentDraft: setupProfileDraft,
        });
        recordAction(ONBOARDING_ACTIONS.EXTRACT_SETUP_PROFILE, ONBOARDING_ACTION_STATUSES.SUCCEEDED, { data: { fallback: "local" } });
        recordMetric(ONBOARDING_METRIC_EVENTS.FALLBACK_USED || "fallback_used", {
          stepId: "preferences",
          fallbackKind: "local_profile_extraction",
          fallbackReason: "server_profile_unavailable",
          inputMethod: inputMethod || "typed",
          conversational: true,
        });
      }
      mergeProfileIntoPreferences(profile);
      setConversationState((current) => ONBOARDING_CONVERSATION.captureAnswer(
        current,
        ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE,
        clean,
        inputMethod || "typed",
      ));
      recordMetric(
        ONBOARDING_METRIC_EVENTS.ANSWER_CAPTURED,
        ONBOARDING_CONVERSATION.metricForAnswer(ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE, inputMethod || "typed"),
      );
    } catch (e) {
      const profile = ONBOARDING_PROFILE.buildProfileDraft({
        transcript: clean,
        currentDraft: setupProfileDraft,
      });
      mergeProfileIntoPreferences(profile);
      setConversationState((current) => ONBOARDING_CONVERSATION.captureAnswer(
        current,
        ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE,
        clean,
        inputMethod || "typed",
      ));
      recordMetric(
        ONBOARDING_METRIC_EVENTS.ANSWER_CAPTURED,
        ONBOARDING_CONVERSATION.metricForAnswer(ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE, inputMethod || "typed"),
      );
      recordAction(ONBOARDING_ACTIONS.EXTRACT_SETUP_PROFILE, ONBOARDING_ACTION_STATUSES.FAILED, {
        error: (e && e.message) || "Could not interpret setup answer. I kept your text for manual editing.",
      });
      recordMetric(ONBOARDING_METRIC_EVENTS.FALLBACK_USED || "fallback_used", {
        stepId: "preferences",
        fallbackKind: "local_profile_extraction",
        fallbackReason: "server_profile_failed",
        inputMethod: inputMethod || "typed",
        conversational: true,
      });
    } finally {
      setProfileBusy(false);
    }
  }

  function handleIntroConsentAnswer(text, inputMethod) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const slotId = ONBOARDING_CONVERSATION.SLOT_IDS.INTRO_CONSENT;
    const repair = ONBOARDING_CONVERSATION.repairForAnswer
      ? ONBOARDING_CONVERSATION.repairForAnswer(slotId, clean)
      : null;
    if (repair && (repair.needsRepair || repair.intent === "help" || repair.intent === "repeat")) {
      const prompt = ONBOARDING_CONVERSATION.promptForStep("intro", conversationState);
      setIntroAnswer(clean);
      setSetupTranscript(clean);
      setRepairState(Object.assign({}, repair, {
        needsRepair: true,
        message: repair.intent === "repeat" && prompt
          ? prompt.question
          : repair.intent === "help" && prompt
            ? prompt.helper
            : repair.message,
      }));
      setSetupError("");
      return;
    }
    setIntroAnswer(clean);
    setSetupTranscript(clean);
    setRepairState(null);
    setSetupError("");
    setConversationState((current) => ONBOARDING_CONVERSATION.captureAnswer(
      current,
      slotId,
      clean,
      inputMethod || "typed",
    ));
    const intent = repair && repair.intent;
    const consent = intent === "affirm" || intent === "voice"
      ? "yes"
      : intent === "skip" || intent === "deny"
        ? "no"
        : ONBOARDING_AUDIO.classifyIntroConsent
          ? ONBOARDING_AUDIO.classifyIntroConsent(clean)
          : "unclear";
    if (consent === "yes") {
      acceptIntroFromConnect();
      goToStep(1);
      return;
    }
    if (consent === "no") {
      skipIntroFromConnect();
      goToStep(2);
      return;
    }
    const fallbackRepair = ONBOARDING_CONVERSATION.repairForAnswer
      ? ONBOARDING_CONVERSATION.repairForAnswer(slotId, clean)
      : null;
    setRepairState(fallbackRepair);
    setSetupError((fallbackRepair && fallbackRepair.message) || "I am not sure if that was a yes or a skip. Use one of the buttons, or type yes or skip.");
  }

  function handleTranscript(text, targetStep) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const activeStep = targetStep || step;
    if (activeStep === "intro" || activeStep === 0) {
      handleIntroConsentAnswer(clean, "voice");
      return;
    }
    if (activeStep === "voice" || activeStep === 1) {
      handleVoiceSetupAnswer(clean, "voice");
      return;
    }
    if (activeStep === "focus" || activeStep === 3) {
      const normalized = clean.toLowerCase().replace(/[^\w\s']/g, "").trim();
      const likelyNoise = ["you", "thank you", "thanks", "okay", "ok"].includes(normalized);
      setSetupTranscript(clean);
      if (likelyNoise) {
        setSetupError("I only heard \"" + clean + "\". Try speaking the project name again, or type it in.");
        return;
      }
      setCampaignName(clean);
      captureFocusNameAsSetupAnswer(clean, "voice");
      return;
    }
    if (activeStep === "preferences" || activeStep === 4) {
      interpretProfileAnswer(clean, "voice");
    }
  }

  transcriptHandlerRef.current = handleTranscript;

  function listenForAnswer(targetStep) {
    setSetupError("");
    stopListeningSession();
    listenTargetRef.current = targetStep || step;
    if (hasDesktopBridge && window.KINGS_DESKTOP.startVoiceSession) {
      setListening(true);
      setAudioState("listening");
      setAudioError("");
      listenSessionRef.current = {
        supported: true,
        stop: function () {
          if (window.KINGS_DESKTOP && window.KINGS_DESKTOP.stopVoiceSession) {
            window.KINGS_DESKTOP.stopVoiceSession().catch(() => {});
          }
        },
      };
      window.KINGS_DESKTOP.startVoiceSession().catch((error) => {
        const message = (error && error.message) || "Local voice transcription is not available. You can type instead.";
        setSetupError(message);
        setAudioError(message);
        setAudioState("error");
        listenSessionRef.current = null;
        setListening(false);
        recordMetric(ONBOARDING_METRIC_EVENTS.FALLBACK_USED || "fallback_used", {
          stepId: (ONBOARDING_STEPS[step] && ONBOARDING_STEPS[step].id) || targetStep || "intro",
          fallbackKind: "typing",
          fallbackReason: "local_whisper_unavailable",
          inputMethod: "voice",
          conversational: true,
        });
      });
      return;
    }
    setListening(true);
    const session = ONBOARDING_AUDIO.listenOnce && ONBOARDING_AUDIO.listenOnce({
      onFinal: (transcript) => {
        setSetupTranscript(transcript);
        handleTranscript(transcript, targetStep);
      },
      onError: (error) => {
        setSetupError((error && error.message) || "Speech recognition is not available here. You can type instead.");
        listenSessionRef.current = null;
        listenTargetRef.current = null;
        setListening(false);
      },
      onEnd: () => {
        listenSessionRef.current = null;
        listenTargetRef.current = null;
        setListening(false);
      },
    });
    if (!session || !session.supported) {
      listenSessionRef.current = null;
      listenTargetRef.current = null;
      setListening(false);
      setSetupError("Speech recognition is not available here. You can type instead.");
      recordMetric(ONBOARDING_METRIC_EVENTS.FALLBACK_USED || "fallback_used", {
        stepId: (ONBOARDING_STEPS[step] && ONBOARDING_STEPS[step].id) || "intro",
        fallbackKind: "typing",
        fallbackReason: "speech_recognition_unavailable",
        inputMethod: "voice",
        conversational: true,
      });
      return;
    }
    listenSessionRef.current = session;
  }

  function toggleListenForAnswer(targetStep) {
    if (listening) {
      stopListeningSession();
      return;
    }
    listenForAnswer(targetStep);
  }

  function stopListeningSession(updateState = true) {
    if (listenSessionRef.current && listenSessionRef.current.stop) {
      try { listenSessionRef.current.stop(); } catch (_err) {}
    }
    listenSessionRef.current = null;
    listenTargetRef.current = null;
    if (updateState) setListening(false);
  }

  async function connectAudio() {
    setAudioError("");
    recordAction(ONBOARDING_ACTIONS.REQUEST_VOICE, ONBOARDING_ACTION_STATUSES.PENDING);
    setAudioState("requesting_microphone");
    const result = ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.requestVoice
      ? await ONBOARDING_ACTION_REGISTRY.requestVoice()
      : null;
    try {
      if (result && result.status === ONBOARDING_ACTION_STATUSES.FAILED) throw new Error(result.error);
      if (!result) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Microphone access is not available here.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        if (hasDesktopBridge && window.KINGS_DESKTOP.startVoiceSession) {
          await window.KINGS_DESKTOP.startVoiceSession();
        }
      }
      setAudioState("audio_ready");
      captureVoiceSetupAnswer("microphone connected", "button");
      recordAction(ONBOARDING_ACTIONS.REQUEST_VOICE, ONBOARDING_ACTION_STATUSES.SUCCEEDED, result || undefined);
    } catch (e) {
      setAudioState("error");
      const message = (e && e.message) || "Audio setup failed. You can continue by typing.";
      setAudioError(message);
      recordAction(ONBOARDING_ACTIONS.REQUEST_VOICE, ONBOARDING_ACTION_STATUSES.FAILED, { error: message });
      recordMetric(ONBOARDING_METRIC_EVENTS.FALLBACK_USED || "fallback_used", {
        stepId: "voice",
        fallbackKind: "typing",
        fallbackReason: "audio_setup_failed",
        inputMethod: "voice",
        conversational: true,
      });
    }
  }

  async function introduce() {
    setConversationState((current) => ONBOARDING_CONVERSATION.captureAnswer(
      current,
      ONBOARDING_CONVERSATION.SLOT_IDS.INTRO_CONSENT,
      "yes",
      "button",
    ));
    setIntroVisible(true);
    recordAction(ONBOARDING_ACTIONS.PLAY_INTRO, ONBOARDING_ACTION_STATUSES.PENDING);
    recordAction(ONBOARDING_ACTIONS.PLAY_INTRO, ONBOARDING_ACTION_STATUSES.SUCCEEDED);
  }

  async function continueFromVoice() {
    if (!voiceSetupHasDecision()) {
      if (voiceConnected) captureVoiceSetupAnswer("microphone connected", "button");
      else skipVoiceSetup();
    }
    goToStep(2);
  }

  async function ensureFocus(nameOverride) {
    const clean = String(nameOverride || campaignName || "").trim();
    captureFocusNameAsSetupAnswer(clean || (activeCampaign && activeCampaign.name) || "Untitled focus", "typed");
    if (activeCampaign && (!clean || clean === activeCampaign.name)) {
      const activation = { campaignId: activeCampaign.id, campaignName: activeCampaign.name || clean || "Current focus", reused: true };
      setFocusActivation(activation);
      return activeCampaign.id;
    }
    const name = clean || "Untitled focus";
    const existing = campaigns.find((campaign) => campaign && campaign.name === name);
    if (existing) {
      if (window.Store.setActiveCampaign) window.Store.setActiveCampaign(existing.id);
      const activation = { campaignId: existing.id, campaignName: existing.name || name, reused: true };
      setFocusActivation(activation);
      recordAction(ONBOARDING_ACTIONS.SAVE_FOCUS, ONBOARDING_ACTION_STATUSES.SUCCEEDED, { data: activation });
      return existing.id;
    }
    setBusy(true);
    recordAction(ONBOARDING_ACTIONS.SAVE_FOCUS, ONBOARDING_ACTION_STATUSES.PENDING);
    try {
      if (ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.saveFocus) {
        const result = await ONBOARDING_ACTION_REGISTRY.saveFocus(name, { activeCampaign, campaigns });
        if (result.status === ONBOARDING_ACTION_STATUSES.FAILED) throw new Error(result.error);
        recordAction(ONBOARDING_ACTIONS.SAVE_FOCUS, ONBOARDING_ACTION_STATUSES.SUCCEEDED, result);
        const activation = {
          campaignId: result.data && result.data.campaignId,
          campaignName: name,
          reused: !!(result.data && result.data.reused),
        };
        setFocusActivation(activation);
        return activation.campaignId;
      }
      const tempId = window.Store.addCampaign(name);
      const saved = window.Store.whenCampaignSaved ? await window.Store.whenCampaignSaved(tempId) : null;
      const campaignId = (saved && saved.id) || tempId;
      const activation = { campaignId, campaignName: (saved && saved.name) || name, reused: false };
      setFocusActivation(activation);
      recordAction(ONBOARDING_ACTIONS.SAVE_FOCUS, ONBOARDING_ACTION_STATUSES.SUCCEEDED, { data: activation });
      return campaignId;
    } catch (e) {
      const message = (e && e.message) || "Could not save the first focus.";
      recordAction(ONBOARDING_ACTIONS.SAVE_FOCUS, ONBOARDING_ACTION_STATUSES.FAILED, { error: message });
      setSetupError(message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  const savePreferences = () => {
    if (!prefDraft || !window.Store.activeReferences) return Promise.resolve(null);
    recordAction(ONBOARDING_ACTIONS.SAVE_PREFERENCES, ONBOARDING_ACTION_STATUSES.PENDING);
    const refs = window.Store.activeReferences() || {};
    const keepBody = (next, current) => {
      const clean = String(next || "").trim();
      return clean || String((current && current.body) || "");
    };
    const keepRules = (next, current) => {
      const parsed = String(next || "").split("\n").map((x) => x.trim()).filter(Boolean);
      return parsed.length ? parsed : ((current && current.rules) || []);
    };
    const throughline = {
      tag: (prefDraft.throughlineTag || "core").trim(),
      name: prefDraft.throughlineName.trim(),
      note: prefDraft.throughlineNote.trim(),
    };
    const audience = {
      id: (prefDraft.audienceId || "general").trim(),
      name: prefDraft.audienceName.trim(),
      note: prefDraft.audienceNote.trim(),
    };
    const strategyList = (refs.strategy && refs.strategy.throughlines) || [];
    const audienceList = (refs.audiences && refs.audiences.list) || [];
    const registerBody = prefDraft.registerBody.trim() ||
      ((refs.registers && refs.registers.body) || "") ||
      ("Default draft style: " + draftStyle.toLowerCase() + ".");
    const patch = {
      strategy: Object.assign({}, refs.strategy || {}, {
        body: keepBody(prefDraft.strategy, refs.strategy),
        throughlines: throughline.name || throughline.note
          ? [throughline].concat(strategyList.slice(1))
          : strategyList,
      }),
      audiences: Object.assign({}, refs.audiences || {}, {
        list: audience.name || audience.note ? [audience].concat(audienceList.slice(1)) : audienceList,
      }),
      registers: Object.assign({}, refs.registers || {}, { body: registerBody }),
      voiceRules: Object.assign({}, refs.voiceRules || {}, {
        rules: keepRules(prefDraft.voiceRules, refs.voiceRules),
      }),
      redLines: Object.assign({}, refs.redLines || {}, {
        rules: keepRules(prefDraft.redLines, refs.redLines),
      }),
      selfVision: Object.assign({}, refs.selfVision || {}, { body: keepBody(prefDraft.selfVision, refs.selfVision) }),
      gateSpec: Object.assign({}, refs.gateSpec || {}, { body: keepBody(prefDraft.gateSpec, refs.gateSpec) }),
    };
    if (setupProfileDraft) {
      patch.setupProfile = {
        version: (setupProfileDraft && setupProfileDraft.version) || 1,
        approvedAt: new Date().toISOString(),
        profile: setupProfileDraft,
      };
    }
    const saved = ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.savePreferences
      ? ONBOARDING_ACTION_REGISTRY.savePreferences(patch)
      : window.Store.updateReferences(patch);
    return Promise.resolve(saved).then((result) => {
      if (result && result.status === ONBOARDING_ACTION_STATUSES.FAILED) throw new Error(result.error);
      recordAction(ONBOARDING_ACTIONS.SAVE_PREFERENCES, ONBOARDING_ACTION_STATUSES.SUCCEEDED, result || undefined);
      return result;
    }).catch((e) => {
      const message = (e && e.message) || "Could not save preferences.";
      recordAction(ONBOARDING_ACTIONS.SAVE_PREFERENCES, ONBOARDING_ACTION_STATUSES.FAILED, { error: message });
      setSetupError(message);
      throw e;
    });
  };

  function ensureRequiredSetupAnswersForTranscript(focusNameInput, options) {
    const skipPreferences = !!(options && options.skipPreferences);
    let next = conversationStateRef.current || conversationState || ONBOARDING_CONVERSATION.createState();
    const slots = (next && next.slots) || {};
    const communicationSlot = slots[ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS];
    const cleanFocus = String(focusNameInput || campaignName || "").trim();
    const cleanSetupAnswer = String(setupAnswer || "").trim();
    if (cleanFocus && (!communicationSlot || communicationSlot.status !== "answered")) {
      next = ONBOARDING_CONVERSATION.captureAnswer(
        next,
        ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS,
        cleanSetupAnswer || cleanFocus,
        cleanSetupAnswer ? (setupAnswerInputMethod || "typed") : "typed",
      );
    }
    const latestSlots = (next && next.slots) || {};
    const voiceProfileSlot = latestSlots[ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE];
    const cleanProfile = String(profileAnswer || "").trim();
    if (!skipPreferences && cleanProfile && (!voiceProfileSlot || voiceProfileSlot.status !== "answered")) {
      next = ONBOARDING_CONVERSATION.captureAnswer(
        next,
        ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE,
        cleanProfile,
        "typed",
      );
    }
    conversationStateRef.current = next;
    setConversationStateBase(next);
    return next;
  }

  const finish = async (options) => {
    const skipPreferences = !!(options && options.skipPreferences);
    setSetupError("");
    setBusy(true);
    try {
      let focusId = focusActivation && focusActivation.campaignId;
      let focusName = focusActivation && focusActivation.campaignName;
      if (!focusId) {
        if (activeCampaign) {
          focusId = activeCampaign.id;
          focusName = activeCampaign.name || campaignName || "Current focus";
          setFocusActivation({ campaignId: focusId, campaignName: focusName, reused: true });
        } else {
          focusId = await ensureFocus(campaignName.trim() || "Untitled focus");
          focusName = campaignName.trim() || "Untitled focus";
        }
      }
      let preferencesSaved = false;
      if (skipPreferences) {
        recordAction(ONBOARDING_ACTIONS.SAVE_PREFERENCES, ONBOARDING_ACTION_STATUSES.SKIPPED);
      } else {
        await savePreferences();
        preferencesSaved = true;
      }
      const setupDurationMs = Date.now() - setupStartedAtRef.current;
      const firstValue = {
        focusReady: !!focusId,
        preferencesSaved,
        preferencesSkipped: skipPreferences,
        campaignId: focusId,
        campaignName: focusName || campaignName || "",
        providerReady: providerConnected,
        routeTarget: focusId ? "desk" : "library",
        setupDurationMs,
        completedFrom: skipPreferences ? "preferences_skipped" : "preferences_saved",
      };
      const finalConversationState = ensureRequiredSetupAnswersForTranscript(firstValue.campaignName, { skipPreferences });
      const setupTranscriptPayload = ONBOARDING_CONVERSATION && ONBOARDING_CONVERSATION.transcriptForState
        ? ONBOARDING_CONVERSATION.transcriptForState(finalConversationState)
        : null;
      let completionPayload = {
        routeTarget: firstValue.routeTarget,
        campaignId: focusId,
        campaignName: firstValue.campaignName,
        firstValue,
        transcript: setupTranscriptPayload,
        sessionId: metricsSessionIdRef.current,
      };
      if (ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.completeOnboarding) {
        const result = await ONBOARDING_ACTION_REGISTRY.completeOnboarding({
          firstValueComplete: !!(focusId && preferencesSaved),
          firstValue,
          transcript: setupTranscriptPayload,
          sessionId: metricsSessionIdRef.current,
        });
        if (result.status === ONBOARDING_ACTION_STATUSES.FAILED) throw new Error(result.error);
        recordAction(ONBOARDING_ACTIONS.COMPLETE_ONBOARDING, ONBOARDING_ACTION_STATUSES.SUCCEEDED, result);
        completionPayload = Object.assign({}, completionPayload, (result && result.data) || {});
      } else {
        recordAction(ONBOARDING_ACTIONS.COMPLETE_ONBOARDING, ONBOARDING_ACTION_STATUSES.SUCCEEDED);
      }
      if (onComplete) onComplete(completionPayload);
    } catch (e) {
      const message = (e && e.message) || "Could not finish setup.";
      setSetupError(message);
      recordAction(ONBOARDING_ACTIONS.COMPLETE_ONBOARDING, ONBOARDING_ACTION_STATUSES.FAILED, { error: message });
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    recordAction(ONBOARDING_ACTIONS.SKIP_ONBOARDING, ONBOARDING_ACTION_STATUSES.SKIPPED);
    recordMetric(ONBOARDING_METRIC_EVENTS.SKIPPED, {
      skippedReason: "user_skipped_setup",
      firstValueComplete: false,
    });
    const action = ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.skipOnboarding
      ? ONBOARDING_ACTION_REGISTRY.skipOnboarding()
      : Promise.resolve(null);
    action.finally(() => {
      if (!ONBOARDING_ACTION_REGISTRY) window.Store.setPref(ONBOARDING_FLAGS.onboardingCompletePref, true);
      if (onClose) onClose();
    });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 190, overflow: "auto",
      background: "#F7F2EB", color: "#2A211E",
      fontFamily: "var(--font-body)",
    }}>
      <style>{`
        .kp-setup-input {
          width: 100%;
          min-height: 55px;
          border: 1px solid #D8CEC3;
          border-radius: 10px;
          background: rgba(255, 252, 246, 0.82);
          color: #2A211E;
          font: 18px var(--font-body);
          padding: 14px 18px;
          outline: none;
          box-shadow: none;
        }
        .kp-setup-input:focus, .kp-setup-primary:focus-visible, .kp-setup-outline:focus-visible, .kp-setup-link:focus-visible, .kp-segment:focus-visible, .kp-chip:focus-visible {
          outline: 3px solid rgba(167, 71, 50, 0.22);
          outline-offset: 2px;
        }
        .kp-setup-primary {
          min-height: 61px;
          min-width: 238px;
          border: 0;
          border-radius: 10px;
          background: #A74732;
          color: white;
          font: 21px var(--font-serif);
          padding: 0 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          cursor: pointer;
          box-shadow: 0 15px 32px rgba(167, 71, 50, 0.16);
        }
        .kp-setup-primary:hover { background: #913B2A; }
        .kp-setup-primary:disabled { opacity: 0.52; cursor: not-allowed; }
        .kp-setup-outline {
          min-height: 47px;
          border: 1px solid #A74732;
          border-radius: 8px;
          background: transparent;
          color: #A74732;
          font: 17px var(--font-serif);
          padding: 0 21px;
          cursor: pointer;
        }
        .kp-setup-outline:hover { background: rgba(167, 71, 50, 0.06); }
        .kp-setup-link {
          min-height: 44px;
          border: 0;
          background: transparent;
          color: #766A63;
          padding: 0;
          font: 18px var(--font-serif);
          text-decoration: underline;
          text-underline-offset: 5px;
          cursor: pointer;
        }
        .kp-chip {
          min-height: 60px;
          border: 1px solid #D8CEC3;
          border-radius: 999px;
          background: rgba(255, 252, 246, 0.72);
          color: #766A63;
          padding: 0 28px;
          display: inline-flex;
          align-items: center;
          gap: 13px;
          font: 18px var(--font-serif);
          cursor: pointer;
        }
        .kp-chip[data-active="true"], .kp-segment[data-active="true"] {
          border-color: #A74732;
          color: #A74732;
          background: rgba(167, 71, 50, 0.045);
        }
        .kp-segment {
          min-height: 55px;
          border: 1px solid #D8CEC3;
          border-radius: 10px;
          background: rgba(255, 252, 246, 0.72);
          color: #766A63;
          padding: 0 20px;
          font: 17px var(--font-serif);
          cursor: pointer;
        }
        .kp-setup-shell {
          margin-top: 44px;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 0;
          align-items: start;
        }
        .kp-setup-shell-centered {
          align-items: center;
          min-height: calc(100vh - 170px);
        }
        .kp-setup-shell-hostless {
          grid-template-columns: minmax(0, 1fr);
          justify-items: center;
          margin-top: 86px;
        }
        .kp-setup-shell-hostless .kp-setup-stage {
          width: min(1040px, 100%);
        }
        .kp-setup-shell-centered.kp-setup-shell-hostless .kp-setup-stage {
          width: min(760px, 100%);
          text-align: center;
        }
        .kp-setup-shell-canvas {
          grid-template-columns: minmax(0, 1fr);
          gap: 0;
          margin-top: 42px;
        }
        .kp-setup-shell-canvas .kp-setup-stage {
          width: min(980px, 100%);
          justify-self: center;
        }
        .kp-setup-shell-canvas.kp-setup-shell-centered {
          align-items: start;
          min-height: 0;
        }
        .kp-onboarding-brand-row {
          width: min(940px, 100%);
          margin: 0 auto;
        }
        .kp-brand-lockup {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          color: #2A211E;
          min-width: 0;
        }
        .kp-brand-lockup-icon {
          width: 38px;
          height: 38px;
          object-fit: contain;
          flex: 0 0 auto;
        }
        .kp-brand-lockup-wordmark {
          display: inline-flex;
          align-items: baseline;
          gap: 7px;
          min-width: 0;
          font-family: var(--font-serif);
          font-size: 27px;
          font-weight: 500;
          line-height: 1;
          white-space: nowrap;
        }
        .kp-brand-lockup-wordmark span {
          letter-spacing: 0.16em;
        }
        .kp-brand-lockup-wordmark em {
          color: #7D2E2E;
          font-style: normal;
          letter-spacing: 0;
        }
        .kp-brand-lockup-compact {
          gap: 9px;
        }
        .kp-brand-lockup-compact .kp-brand-lockup-icon {
          width: 31px;
          height: 31px;
        }
        .kp-brand-lockup-compact .kp-brand-lockup-wordmark {
          gap: 6px;
          font-size: 19px;
        }
        .kp-brand-lockup-compact .kp-brand-lockup-wordmark span {
          letter-spacing: 0.13em;
        }
        .kp-conversation-canvas {
          width: min(940px, 100%);
          justify-self: center;
          border: 1px solid rgba(216, 206, 195, 0.74);
          border-radius: 22px;
          background:
            linear-gradient(180deg, rgba(255, 252, 246, 0.78), rgba(255, 252, 246, 0.52)),
            rgba(255, 252, 246, 0.54);
          box-shadow: 0 22px 58px rgba(42, 33, 30, 0.045);
          overflow: hidden;
        }
        .kp-conversation-toolbar {
          min-height: 72px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(216, 206, 195, 0.62);
        }
        .kp-conversation-host {
          display: flex;
          align-items: center;
          gap: 13px;
          min-width: 0;
        }
        .kp-conversation-state {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .kp-conversation-state span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #766A63;
          font-size: 12px;
        }
        .kp-conversation-state strong {
          color: #2A211E;
          font: 21px var(--font-serif);
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kp-conversation-thread {
          position: relative;
          display: grid;
          gap: 12px;
          padding: 24px clamp(18px, 4vw, 38px) 28px;
        }
        .kp-conversation-thread::before {
          content: "";
          position: absolute;
          inset: 0 0 auto;
          height: 22px;
          background: linear-gradient(180deg, rgba(255, 252, 246, 0.94), rgba(255, 252, 246, 0));
          pointer-events: none;
        }
        .kp-chat-turn {
          display: flex;
          gap: 11px;
          align-items: flex-start;
          max-width: min(720px, 100%);
        }
        .kp-chat-turn p {
          margin: 0;
          border: 1px solid rgba(216, 206, 195, 0.68);
          border-radius: 16px;
          padding: 13px 16px;
          color: #5E534D;
          background: rgba(247, 242, 235, 0.72);
          line-height: 1.48;
          font-size: 16px;
        }
        .kp-chat-turn-user {
          justify-self: end;
          justify-content: flex-end;
        }
        .kp-chat-turn-user p {
          background: rgba(167, 71, 50, 0.08);
          border-color: rgba(167, 71, 50, 0.24);
          color: #2A211E;
        }
        .kp-chat-avatar {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          overflow: hidden;
          background: #7D2E2E;
          border: 1px solid rgba(150, 108, 34, 0.45);
          box-shadow: 0 1px 2px rgba(42, 33, 30, 0.12);
          flex: 0 0 auto;
        }
        .kp-chat-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .kp-conversation-status {
          padding: 0 20px 18px;
          color: #A74732;
          font-size: 14px;
          line-height: 1.45;
        }
        .kp-conversation-composer {
          border-top: 1px solid rgba(216, 206, 195, 0.62);
          background: rgba(247, 242, 235, 0.34);
          padding: clamp(18px, 3vw, 30px);
        }
        .kp-conversation-composer > section {
          border-color: rgba(216, 206, 195, 0.82) !important;
          background: rgba(255, 252, 246, 0.46) !important;
          box-shadow: none;
        }
        .kp-conversation-composer > .kp-answer-composer {
          margin-top: 0;
        }
        .kp-welcome-screen {
          width: min(720px, 100%);
          margin: 0 auto;
        }
        .kp-host-panel {
          position: sticky;
          top: 28px;
          border: 1px solid rgba(216, 206, 195, 0.82);
          border-radius: 14px;
          background: rgba(255, 252, 246, 0.58);
          padding: 24px;
          color: #2A211E;
          box-shadow: 0 18px 50px rgba(42, 33, 30, 0.045);
        }
        .kp-host-heading {
          display: flex;
          gap: 14px;
          align-items: center;
        }
        .kp-host-heading > div {
          display: grid;
          gap: 7px;
          min-width: 0;
        }
        .kp-host-heading h2 {
          margin: 0;
          font: 24px var(--font-serif);
          color: #2A211E;
        }
        .kp-host-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #766A63;
          font-size: 12px;
        }
        .kp-host-messages {
          margin-top: 22px;
          display: grid;
          gap: 12px;
        }
        .kp-host-messages p {
          margin: 0;
          padding: 14px 15px;
          border-radius: 12px;
          background: rgba(247, 242, 235, 0.82);
          border: 1px solid rgba(216, 206, 195, 0.68);
          color: #766A63;
          line-height: 1.48;
          font-size: 15.5px;
        }
        .kp-inline-model-setup {
          padding: 22px 26px 24px;
          display: grid;
          gap: 13px;
        }
        .kp-inline-intro-consent {
          padding: 22px 26px;
          display: grid;
          gap: 16px;
        }
        .kp-inline-intro-copy {
          min-width: 0;
        }
        .kp-inline-intro-copy h3 {
          margin: 2px 0 0;
          font-family: var(--font-serif);
          font-size: 27px;
          font-weight: 500;
          color: #2A211E;
        }
        .kp-inline-intro-copy p:not(.kp-inline-step-label) {
          margin: 6px 0 0;
          max-width: 650px;
          color: #766A63;
          font-size: 15.5px;
          line-height: 1.35;
        }
        .kp-inline-intro-answer {
          display: grid;
          gap: 8px;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        .kp-inline-intro-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-start;
          gap: 8px;
        }
        .kp-inline-intro-actions .kp-setup-primary,
        .kp-inline-intro-actions .kp-setup-outline {
          min-height: 40px;
          font-size: 15.5px;
          padding: 0 16px;
        }
        .kp-inline-model-head {
          display: grid;
          grid-template-columns: 62px minmax(0, 1fr) auto;
          align-items: center;
          gap: 17px;
        }
        .kp-inline-model-icon {
          width: 52px;
          height: 52px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: rgba(216, 206, 195, 0.34);
          color: #2A211E;
        }
        .kp-inline-model-head h3 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: 24px;
          font-weight: 500;
          color: #2A211E;
        }
        .kp-inline-model-head p {
          margin: 5px 0 0;
          max-width: 620px;
          color: #766A63;
          font-size: 15.5px;
          line-height: 1.35;
        }
        .kp-inline-model-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding-left: 79px;
        }
        .kp-inline-model-tabs button {
          min-height: 34px;
          border: 1px solid #D8CEC3;
          border-radius: 999px;
          background: rgba(255, 252, 246, 0.72);
          color: #766A63;
          padding: 0 13px;
          font: 14.5px var(--font-serif);
          cursor: pointer;
        }
        .kp-inline-model-tabs button.active {
          background: #A74732;
          border-color: #A74732;
          color: white;
        }
        .kp-inline-model-tabs button:focus-visible {
          outline: 3px solid rgba(167, 71, 50, 0.22);
          outline-offset: 2px;
        }
        .kp-inline-model-fields {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 9px;
          padding-left: 79px;
        }
        .kp-inline-model-setup > .kp-provider-card-grid {
          margin-left: 79px;
        }
        .kp-inline-model-fields label {
          display: grid;
          gap: 5px;
        }
        .kp-inline-model-fields label > span {
          color: #766A63;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .kp-inline-model-setup .kp-setup-input,
        .kp-inline-voice-setup .kp-setup-input {
          min-height: 43px;
          border-radius: 8px;
          padding: 9px 13px;
          font-size: 16px;
        }
        .kp-inline-model-wide {
          grid-column: 1 / -1;
        }
        .kp-inline-model-local {
          grid-column: 1 / -1;
          border: 1px solid #D8CEC3;
          border-radius: 10px;
          background: rgba(247, 242, 235, 0.52);
          padding: 14px 16px;
          display: grid;
          gap: 3px;
        }
        .kp-inline-model-local strong {
          font: 18px var(--font-serif);
          color: #2A211E;
        }
        .kp-inline-model-local span {
          color: #766A63;
          font-size: 14.5px;
          line-height: 1.4;
        }
        .kp-inline-model-actions {
          padding-left: 79px;
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 7px;
        }
        .kp-inline-model-actions .kp-setup-primary,
        .kp-inline-model-actions .kp-setup-outline {
          min-height: 40px;
          font-size: 15.5px;
          padding: 0 16px;
        }
        .kp-inline-model-actions .kp-setup-primary {
          min-width: 124px;
        }
        .kp-inline-model-message {
          margin: -2px 0 0 79px;
          color: #A74732;
          font-size: 14.5px;
          line-height: 1.45;
        }
        .kp-inline-voice-setup {
          border-top: 1px solid #D8CEC3;
          padding: 22px 26px 24px;
          display: grid;
          gap: 13px;
        }
        .kp-inline-voice-head {
          display: grid;
          grid-template-columns: 62px minmax(0, 1fr) auto;
          align-items: center;
          gap: 17px;
        }
        .kp-inline-voice-head h3 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: 24px;
          font-weight: 500;
          color: #2A211E;
        }
        .kp-inline-voice-head p {
          margin: 5px 0 0;
          max-width: 620px;
          color: #766A63;
          font-size: 15.5px;
          line-height: 1.35;
        }
        .kp-inline-voice-controls {
          padding-left: 79px;
          display: grid;
          grid-template-columns: minmax(260px, 1fr) auto;
          align-items: end;
          gap: 9px;
        }
        .kp-provider-card-grid {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 4px;
        }
        .kp-provider-card {
          min-height: 150px;
          border: 1px solid rgba(216, 206, 195, 0.88);
          border-radius: 10px;
          background: rgba(255, 252, 246, 0.64);
          color: #2A211E;
          display: grid;
          grid-template-rows: auto 1fr;
          gap: 13px;
          padding: 16px;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
        }
        .kp-provider-card:hover {
          border-color: rgba(167, 71, 50, 0.42);
          background: rgba(255, 252, 246, 0.9);
        }
        .kp-provider-card:focus-visible {
          outline: 3px solid rgba(167, 71, 50, 0.22);
          outline-offset: 2px;
        }
        .kp-provider-card[data-active="true"] {
          border-color: #A74732;
          background: rgba(167, 71, 50, 0.055);
          box-shadow: inset 0 0 0 1px rgba(167, 71, 50, 0.14);
        }
        .kp-provider-logo {
          width: 112px;
          height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
        }
        .kp-provider-logo img {
          display: block;
          max-width: 112px;
          max-height: 28px;
          object-fit: contain;
        }
        .kp-provider-logo-gemini,
        .kp-provider-logo-xai,
        .kp-provider-logo-api,
        .kp-provider-logo-openai-compatible,
        .kp-provider-logo-hedra {
          width: 32px;
        }
        .kp-provider-logo-gemini img,
        .kp-provider-logo-xai img,
        .kp-provider-logo-api img,
        .kp-provider-logo-openai-compatible img,
        .kp-provider-logo-hedra img {
          max-width: 32px;
          max-height: 28px;
        }
        .kp-provider-card-copy {
          display: grid;
          gap: 4px;
        }
        .kp-provider-card-copy strong {
          font-size: 15.5px;
          line-height: 1.15;
        }
        .kp-provider-card-copy em {
          color: #7D2E2E;
          font-style: normal;
          font-size: 13px;
          line-height: 1.2;
        }
        .kp-provider-card-copy span {
          color: #766A63;
          font-size: 13.5px;
          line-height: 1.35;
        }
        .kp-inline-voice-controls label {
          display: grid;
          gap: 5px;
        }
        .kp-inline-voice-controls label > span {
          color: #766A63;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .kp-api-key-label {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .kp-api-key-help-toggle {
          border: 0;
          background: transparent;
          color: #7D2E2E;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 0;
          font: 12px var(--font-body);
          letter-spacing: 0;
          text-transform: none;
          cursor: pointer;
        }
        .kp-api-key-help-toggle > span {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          display: inline-grid;
          place-items: center;
          border: 1px solid rgba(167, 71, 50, 0.42);
          color: #A74732;
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
        }
        .kp-api-key-help-toggle:hover {
          color: #A74732;
        }
        .kp-api-key-help-toggle:focus-visible {
          outline: 3px solid rgba(167, 71, 50, 0.22);
          outline-offset: 2px;
          border-radius: 6px;
        }
        .kp-inline-voice-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          justify-content: flex-end;
        }
        .kp-inline-voice-actions .kp-setup-outline,
        .kp-inline-voice-actions .kp-setup-primary {
          min-height: 40px;
          font-size: 15.5px;
          padding: 0 16px;
        }
        .kp-inline-voice-actions .kp-setup-primary {
          min-width: 116px;
        }
        .kp-inline-provider-help {
          margin: 0 0 0 79px;
          border: 1px solid rgba(216, 206, 195, 0.82);
          border-radius: 10px;
          background: rgba(247, 242, 235, 0.62);
          padding: 15px 17px;
          display: grid;
          gap: 10px;
          color: #5E534D;
        }
        .kp-inline-provider-help strong {
          color: #2A211E;
          font: 18px var(--font-serif);
          font-weight: 600;
        }
        .kp-inline-provider-help ol {
          margin: 0;
          padding-left: 20px;
          display: grid;
          gap: 6px;
          font-size: 14.5px;
          line-height: 1.45;
        }
        .kp-inline-provider-links {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          font-size: 14px;
        }
        .kp-inline-provider-links button {
          border: 0;
          background: transparent;
          padding: 0;
          color: #7D2E2E;
          font: inherit;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .kp-inline-provider-links button:focus-visible {
          outline: 3px solid rgba(167, 71, 50, 0.22);
          outline-offset: 3px;
          border-radius: 4px;
        }
        .kp-host-error {
          margin: 18px 0 0;
          color: #A74732;
          font-size: 14px;
          line-height: 1.45;
        }
        .kp-setup-stage {
          min-width: 0;
        }
        .kp-answer-composer {
          margin: 0 auto;
          max-width: 680px;
          display: grid;
          gap: 14px;
          text-align: left;
        }
        .kp-answer-composer label {
          display: grid;
          gap: 10px;
          color: #2A211E;
        }
        .kp-answer-composer label > span {
          font: 20px var(--font-serif);
        }
        .kp-answer-helper {
          margin: -4px 0 2px;
          color: #766A63;
          font-size: 14.5px;
          line-height: 1.4;
        }
        .kp-answer-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 12px;
        }
        .kp-answer-actions .kp-setup-primary {
          min-width: 180px;
          min-height: 50px;
          font-size: 18px;
        }
        .kp-focus-voice-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 12px;
        }
        .kp-focus-voice-row .kp-setup-outline {
          min-height: 42px;
          font-size: 15.5px;
        }
        .kp-repair-box {
          border: 1px solid rgba(167, 71, 50, 0.24);
          border-radius: 12px;
          background: rgba(167, 71, 50, 0.045);
          padding: 13px 14px;
          display: grid;
          gap: 10px;
        }
        .kp-repair-box p {
          margin: 0;
          color: #766A63;
          font-size: 14.5px;
          line-height: 1.4;
        }
        .kp-repair-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .kp-repair-actions .kp-setup-outline {
          min-height: 36px;
          font-size: 14.5px;
          padding: 0 13px;
        }
        .kp-transcript-preview {
          margin: 0;
          color: #766A63;
          font-size: 14.5px;
          line-height: 1.45;
        }
        .kp-profile-review {
          margin: 0 0 28px;
          border: 1px solid rgba(167, 71, 50, 0.24);
          border-radius: 12px;
          background: rgba(255, 252, 246, 0.72);
          padding: 24px;
          display: grid;
          gap: 20px;
        }
        .kp-profile-review h2 {
          margin: 5px 0 7px;
          font: 28px/1.15 var(--font-serif);
          font-weight: 500;
          color: #2A211E;
        }
        .kp-profile-review p {
          margin: 0;
          color: #766A63;
          line-height: 1.45;
        }
        .kp-profile-eyebrow {
          font-size: 12px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
        }
        .kp-profile-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 12px;
        }
        .kp-profile-grid div {
          border: 1px solid #D8CEC3;
          border-radius: 10px;
          padding: 14px;
          background: rgba(247, 242, 235, 0.44);
        }
        .kp-profile-grid span {
          display: block;
          color: #766A63;
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .kp-profile-grid strong {
          display: block;
          color: #2A211E;
          font: 16px/1.35 var(--font-serif);
          font-weight: 500;
        }
        @media (max-width: 780px) {
          .kp-setup-shell, .kp-setup-shell-centered {
            grid-template-columns: 1fr;
            margin-top: 42px;
            min-height: 0;
          }
          .kp-setup-shell-hostless {
            margin-top: 54px;
          }
          .kp-host-panel {
            position: static;
          }
          .kp-conversation-toolbar {
            align-items: flex-start;
            flex-direction: column;
          }
          .kp-chat-turn,
          .kp-chat-turn-user {
            max-width: 100%;
          }
          .kp-setup-row { grid-template-columns: 1fr !important; }
          .kp-inline-model-setup { padding: 30px 24px; }
          .kp-inline-model-head,
          .kp-inline-voice-head { grid-template-columns: 1fr; }
          .kp-inline-model-tabs,
          .kp-inline-model-fields,
          .kp-inline-model-actions,
          .kp-inline-model-message,
          .kp-inline-model-setup > .kp-provider-card-grid,
          .kp-inline-voice-controls,
          .kp-inline-intro-copy { padding-left: 0; margin-left: 0; }
          .kp-inline-model-fields,
          .kp-inline-voice-controls { grid-template-columns: 1fr; }
          .kp-provider-card-grid { grid-template-columns: 1fr; }
          .kp-inline-intro-consent { grid-template-columns: 1fr; }
          .kp-inline-model-actions,
          .kp-inline-voice-actions,
          .kp-inline-intro-actions { justify-content: flex-start; }
        }
      `}</style>
      <div style={{ width: "min(1120px, calc(100% - 72px))", margin: "0 auto", padding: "44px 0 34px" }}>
        <OnboardingBrand />

        {step === 0 && (
      <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} setupError={setupError} conversationState={conversationState} muted={audioMuted} onToggleMute={() => setAudioMuted((value) => !value)} centered hostless>
            <section style={{
              border: "1px solid #D8CEC3", borderRadius: 10, background: "rgba(255, 252, 246, 0.68)",
              overflow: "hidden",
            }}>
              <IntroConsentSetup
                answered={false}
                value={introAnswer}
                onChange={(value) => {
                  setIntroAnswer(value);
                  if (repairState) setRepairState(null);
                  if (setupError) setSetupError("");
                }}
                onSubmit={() => handleIntroConsentAnswer(introAnswer, "typed")}
                onListen={() => toggleListenForAnswer("intro")}
                listening={listening}
                transcript={step === 0 ? setupTranscript : ""}
                repair={repairState && repairState.slotId === ONBOARDING_CONVERSATION.SLOT_IDS.INTRO_CONSENT ? repairState : null}
                onRepairChoose={(suggestion) => {
                  const next = suggestion && suggestion.value ? suggestion.value : "";
                  setIntroAnswer(next);
                  handleIntroConsentAnswer(next, "button");
                }}
                onAccept={() => {
                  acceptIntroFromConnect();
                  goToStep(1);
                }}
                onSkip={() => {
                  skipIntroFromConnect();
                  skip();
                }}
              />
            </section>
            {setupError && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{setupError}</p>
            )}
            <SetupReassurance compact />
          </SetupShell>
        )}

        {step === 1 && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} setupError={setupError} conversationState={conversationState} muted={audioMuted} onToggleMute={() => setAudioMuted((value) => !value)}>
            <section style={{
              border: "1px solid #D8CEC3", borderRadius: 10, background: "rgba(255, 252, 246, 0.68)",
              overflow: "hidden",
            }}>
              <InlineVoiceSetup
                status={providerStatus}
                audioState={audioState}
                onConnect={connectAudio}
                onVoiceConfigured={handleVoiceConfigured}
                onLLMSaved={(profile) => setProviderStatus((current) => Object.assign({}, current || {}, {
                  provider: profile && profile.provider,
                  model: profile && profile.model,
                  hasApiKey: !!(profile && (profile.apiKey || profile.hasApiKey)),
                  profiles: profile ? [{
                    id: profile.id,
                    label: profile.label,
                    provider: profile.provider,
                    model: profile.model,
                    baseUrl: profile.baseUrl || null,
                    hasApiKey: !!(profile.apiKey || profile.hasApiKey),
                  }] : current && current.profiles,
                }))}
              />
              <div style={{ padding: repairState && repairState.slotId === ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_SETUP ? "0 34px 24px" : 0 }}>
                <SetupRepairChoices
                  repair={repairState && repairState.slotId === ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_SETUP ? repairState : null}
                  onChoose={(suggestion) => handleVoiceSetupAnswer((suggestion && suggestion.value) || "", "button")}
                />
              </div>
            </section>
            {audioState === "error" && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{audioError}</p>
            )}
            {setupError && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{setupError}</p>
            )}
            <SetupActions
              secondary="Back"
              onSecondary={() => goToStep(0)}
              primary={voiceConnected ? "Continue" : "Continue without voice"}
              onPrimary={continueFromVoice}
            />
            <SetupReassurance />
          </SetupShell>
        )}

        {step === 2 && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} setupError={setupError} conversationState={conversationState} muted={audioMuted} onToggleMute={() => setAudioMuted((value) => !value)}>
            <section style={{
              border: "1px solid #D8CEC3", borderRadius: 10, background: "rgba(255, 252, 246, 0.68)",
              overflow: "hidden",
            }}>
              <InlineModelSetup
                status={providerStatus}
                onSaved={(profile) => setProviderStatus((current) => Object.assign({}, current || {}, {
                  provider: profile && profile.provider,
                  model: profile && profile.model,
                  hasApiKey: !!(profile && (profile.apiKey || profile.hasApiKey)),
                  profiles: profile ? [{
                    id: profile.id,
                    label: profile.label,
                    provider: profile.provider,
                    model: profile.model,
                    baseUrl: profile.baseUrl || null,
                    hasApiKey: !!(profile.apiKey || profile.hasApiKey),
                  }] : current && current.profiles,
                }))}
              />
            </section>
            {setupError && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{setupError}</p>
            )}
            <SetupActions
              secondary="Back"
              onSecondary={() => goToStep(1)}
              primary="Continue"
              onPrimary={() => goToStep(3)}
            />
            <SetupReassurance />
          </SetupShell>
        )}

        {step === 3 && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} setupError={setupError} conversationState={conversationState} muted={audioMuted} onToggleMute={() => setAudioMuted((value) => !value)}>
            <SetupField label="First project or campaign name" helper="Name the first place Pillar Press should organize drafts, sources, and notes.">
              <input
                className="kp-setup-input"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") ensureFocus().then(() => goToStep(4)); }}
                placeholder="e.g. Launch plan, Book draft, Newsletter"
                style={{ fontFamily: "var(--font-serif)", fontSize: 25, height: 75 }}
              />
              <div className="kp-focus-voice-row">
                <button className="kp-setup-outline" type="button" onClick={() => toggleListenForAnswer("focus")} aria-pressed={listening ? "true" : "false"}>
                  <Icon name="mic" size={16} /> {listening ? "Stop listening" : "Speak answer"}
                </button>
                {setupTranscript && step === 3 && (
                  <p className="kp-transcript-preview" aria-live="polite">I heard: <strong>{setupTranscript}</strong></p>
                )}
              </div>
              <SetupRepairChoices
                repair={repairState && repairState.slotId === ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS ? repairState : null}
                onChoose={(suggestion) => {
                  const next = (suggestion && suggestion.value) || "";
                  setCampaignName(next);
                  setSetupTranscript(next);
                  captureFocusNameAsSetupAnswer(next, "button");
                }}
              />
            </SetupField>
            <p style={{ margin: "14px 0 0", color: "#766A63", fontSize: 16, lineHeight: 1.45 }}>
              {focusSuggestions}
            </p>
            <SetupActions
              secondary="Back"
              onSecondary={() => goToStep(2)}
              primary="Continue"
              busy={busy}
              onPrimary={() => {
                ensureFocus().then(() => goToStep(4)).catch(() => null);
              }}
            />
            {setupError && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{setupError}</p>
            )}
            <SetupReassurance />
          </SetupShell>
        )}

        {step === 4 && prefDraft && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} setupError={setupError} conversationState={conversationState} muted={audioMuted} onToggleMute={() => setAudioMuted((value) => !value)}>
            <SetupAnswerComposer
              question={preferencesPrompt && preferencesPrompt.question}
              helper={preferencesPrompt && preferencesPrompt.helper}
              value={profileAnswer}
              onChange={setProfileAnswer}
              onListen={() => toggleListenForAnswer("preferences")}
              listening={listening}
              disabled={profileBusy}
              transcript={step === 4 ? setupTranscript : ""}
              placeholder={preferencesPrompt && preferencesPrompt.placeholder}
              actionLabel={profileBusy ? "Saving" : ((preferencesPrompt && preferencesPrompt.actionLabel) || "Save")}
              onSubmit={() => interpretProfileAnswer(profileAnswer, "typed")}
              repair={repairState && repairState.slotId === ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE ? repairState : null}
              showTranscript={false}
              showRepair={false}
              onRepairChoose={(suggestion) => {
                const next = (suggestion && suggestion.value) || "";
                setProfileAnswer(next);
                interpretProfileAnswer(next, "button");
              }}
            />
            {setupProfileDraft && <div style={{ height: 28 }} />}
            {setupProfileDraft && <section style={{
              border: "1px solid #D8CEC3", borderRadius: 10, background: "rgba(255, 252, 246, 0.64)",
              overflow: "hidden",
            }}>
              <div style={{ padding: "30px 30px 28px", display: "grid", gap: 30 }}>
                <SetupField label="Brand voice" helper="How the writing should sound. Example: Clear, direct, thoughtful, premium but not stiff. Avoid hype, jargon, and forced urgency.">
                  <textarea
                    className="kp-setup-input"
                    value={prefDraft.selfVision}
                    onChange={(e) => setPrefDraft({ ...prefDraft, selfVision: e.target.value })}
                    rows={4}
                    placeholder="e.g. I'm a founder building for operators. Clear, bold, and useful."
                    style={{ resize: "vertical", minHeight: 132 }}
                  />
                </SetupField>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 28 }}>
                  <SetupField label="Primary audience" helper="Who this is usually written for. Examples: founders and operators, newsletter subscribers, prospective clients, internal team, civic leaders, first-time buyers.">
                    <input
                      className="kp-setup-input"
                      value={prefDraft.audienceName}
                      onChange={(e) => setPrefDraft({ ...prefDraft, audienceName: e.target.value })}
                      placeholder="e.g. Independent operators"
                    />
                  </SetupField>
                  <SetupField label="Throughline" helper="The central idea Pillar Press should keep reinforcing across drafts. Examples: practical AI adoption, calm executive clarity, building trust through transparency, turning expertise into useful content.">
                    <input
                      className="kp-setup-input"
                      value={prefDraft.throughlineName}
                      onChange={(e) => setPrefDraft({ ...prefDraft, throughlineName: e.target.value })}
                      placeholder="e.g. Core insight or point of view"
                    />
                  </SetupField>
                </div>
                <SetupField label="Do-nots / red lines" helper="Constraints Pillar Press should respect. Examples: no hype, no jargon, no unsupported claims, no fake urgency, no over-polishing my wording.">
                  <textarea
                    className="kp-setup-input"
                    value={prefDraft.redLines}
                    onChange={(e) => setPrefDraft({ ...prefDraft, redLines: e.target.value })}
                    rows={3}
                    placeholder="e.g. No hype. Do not invent proof. Avoid generic AI-sounding phrases."
                    style={{ resize: "vertical", minHeight: 104 }}
                  />
                </SetupField>
              </div>
              <div style={{ borderTop: "1px solid #D8CEC3" }}>
                <button
                  onClick={() => setAdvancedOpen((x) => !x)}
                  aria-expanded={advancedOpen}
                  style={{
                    width: "100%", minHeight: 93, border: 0, background: "transparent", color: "#2A211E",
                    display: "grid", gridTemplateColumns: "42px minmax(0, 1fr) auto", alignItems: "center",
                    gap: 24, padding: "20px 30px", textAlign: "left", cursor: "pointer",
                  }}
                >
                  <Icon name="gear" size={28} />
                  <span>
                    <span style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 22 }}>Advanced rules</span>
                    <span style={{ display: "block", marginTop: 5, color: "#766A63", fontSize: 16 }}>Optional strategy notes and editorial guidance.</span>
                  </span>
                  <Icon name="chevD" size={22} style={{ transform: advancedOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                </button>
                {advancedOpen && (
                  <div style={{ padding: "0 30px 30px", display: "grid", gap: 22 }}>
                    <SetupField label="Point-of-view note" helper="A fuller version of the throughline above. Use this for nuance, stakes, or language Pillar Press should preserve.">
                      <textarea className="kp-setup-input" value={prefDraft.throughlineNote} onChange={(e) => setPrefDraft({ ...prefDraft, throughlineNote: e.target.value })} rows={3} />
                    </SetupField>
                    <SetupField label="Strategy note" helper="How drafts should turn the point of view into useful content for the selected format.">
                      <textarea className="kp-setup-input" value={prefDraft.strategy} onChange={(e) => setPrefDraft({ ...prefDraft, strategy: e.target.value })} rows={3} />
                    </SetupField>
                    <SetupField label="Audience note" helper="Extra context about what this audience already knows, cares about, or needs from the writing.">
                      <textarea className="kp-setup-input" value={prefDraft.audienceNote} onChange={(e) => setPrefDraft({ ...prefDraft, audienceNote: e.target.value })} rows={3} />
                    </SetupField>
                    <SetupField label="Drafting notes" helper="General guidance for structure, polish, and how much of your original wording to preserve.">
                      <textarea className="kp-setup-input" value={prefDraft.registerBody} onChange={(e) => setPrefDraft({ ...prefDraft, registerBody: e.target.value })} rows={3} />
                    </SetupField>
                    <SetupField label="Tone rules" helper="Specific rules Pillar Press should follow when shaping language.">
                      <textarea className="kp-setup-input" value={prefDraft.voiceRules} onChange={(e) => setPrefDraft({ ...prefDraft, voiceRules: e.target.value })} rows={3} placeholder="One rule per line." />
                    </SetupField>
                    <SetupField label="Editorial guardrails" helper="Review standards for claims, accuracy, generic phrasing, and things that should be flagged before publishing.">
                      <textarea className="kp-setup-input" value={prefDraft.gateSpec} onChange={(e) => setPrefDraft({ ...prefDraft, gateSpec: e.target.value })} rows={4} placeholder="e.g. Be strict on unsupported claims, gentle on voice, and flag anything that sounds generic." />
                    </SetupField>
                  </div>
                )}
              </div>
            </section>}
            <SetupActions
              secondary="Back"
              onSecondary={() => goToStep(3)}
              primary="Finish setup"
              onPrimary={() => finish()}
              busy={busy}
            />
            {setupError && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{setupError}</p>
            )}
            <SetupReassurance compact />
          </SetupShell>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { SetupHelper });
