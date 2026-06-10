/* First-run setup helper. Keeps secrets in the native provider dialog and
   writes preferences through the existing Store/references routes. */

const ONBOARDING_COPY = window.KP_ONBOARDING_COPY || {
  getPressIntroScript: () => "I'm King's Press.\n\nTo start, tell me where you communicate most.",
};
const ONBOARDING_AUDIO = window.KP_ONBOARDING_AUDIO || {
  speakText: () => Promise.resolve(),
};
const ONBOARDING_RUNTIME = window.KP_CONVERSATIONAL_ONBOARDING || null;
const ONBOARDING_ACTION_REGISTRY = window.KP_ONBOARDING_ACTIONS || null;
const ONBOARDING_PROFILE = window.KP_ONBOARDING_PROFILE || {
  buildProfileDraft: ({ transcript }) => ({
    version: "fallback",
    brand: "kings_press",
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
      question: "Tell me how this desk should sound for you.",
      helper: "Say who you are, who you write for, and how much polish you want.",
      placeholder: "e.g. Clear, useful, direct.",
      actionLabel: "Use for defaults",
      progressText: "",
    }
    : {
      slotId: "communication_platforms",
      question: ONBOARDING_COPY.FIRST_PLATFORM_QUESTION || "Where do you communicate most?",
      helper: "Answer naturally. I will turn this into setup defaults.",
      placeholder: "e.g. LinkedIn, Substack, scripts, and book chapters.",
      actionLabel: "Capture answer",
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
  footer: "King's Press · Your desk for ideas that matter.",
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

function OnboardingBrand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#2A211E" }}>
      <span aria-hidden="true" style={{
        width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center",
        background: "rgba(167, 71, 50, 0.10)", color: "#A74732", fontFamily: "var(--font-serif)",
        fontSize: 17, fontWeight: 700,
      }}>K</span>
      <strong style={{ fontFamily: "var(--font-serif)", fontSize: 27, fontWeight: 500, lineHeight: 1 }}>
        King's Press
      </strong>
    </div>
  );
}

function OnboardingStepper({ step }) {
  return (
    <nav aria-label="Setup progress" style={{
      display: "grid", gridTemplateColumns: "repeat(" + ONBOARDING_STEPS.length + ", minmax(0, 1fr))", alignItems: "center",
      gap: 8, marginTop: 72, color: "#766A63",
    }}>
      {ONBOARDING_STEPS.map((item, i) => {
        const label = item.label;
        const active = step === i;
        const done = i < step;
        return (
          <div key={label} aria-current={active ? "step" : undefined} style={{
            display: "grid", gridTemplateColumns: "auto auto minmax(24px, 1fr)", alignItems: "center",
            gap: 10, minWidth: 0,
          }}>
            <span style={{
              width: 39, height: 39, borderRadius: 999, display: "grid", placeItems: "center",
              border: "1px solid " + (active ? "#A74732" : "#D8CEC3"),
              color: active ? "#A74732" : (done ? "#766A63" : "#766A63"),
              background: active ? "rgba(167, 71, 50, 0.045)" : "transparent",
              fontFamily: "var(--font-serif)", fontSize: 17,
            }}>{i + 1}</span>
            <span style={{
              color: active ? "#A74732" : "#766A63",
              fontFamily: "var(--font-serif)", fontSize: 17, whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}>{label}</span>
            {i < ONBOARDING_STEPS.length - 1 && <span aria-hidden="true" style={{
              height: 1, minWidth: 12, background: "#D8CEC3", opacity: 0.9,
            }} />}
          </div>
        );
      })}
    </nav>
  );
}

function getActionStatusLabel(status) {
  if (status === ONBOARDING_ACTION_STATUSES.PENDING) return "Working";
  if (status === ONBOARDING_ACTION_STATUSES.SUCCEEDED) return "Done";
  if (status === ONBOARDING_ACTION_STATUSES.FAILED) return "Needs attention";
  if (status === ONBOARDING_ACTION_STATUSES.SKIPPED) return "Skipped";
  return "Ready";
}

function SetupMotionMark({ state }) {
  const mode = state || "idle";
  return (
    <span className={"kp-host-orb kp-host-orb-" + mode} aria-hidden="true">
      <span />
    </span>
  );
}

function SetupChoiceChip({ label, active, onClick, icon }) {
  return (
    <button className="kp-choice-chip" data-active={active ? "true" : "false"} onClick={onClick}>
      {icon && <Icon name={icon} size={16} />}
      {label}
    </button>
  );
}

function SetupHostPanel({ conversation, mode, onModeChange, actionResults, setupError }) {
  const results = Object.values(actionResults || {})
    .filter(Boolean)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
    .slice(-4);
  return (
    <aside className="kp-host-panel" aria-label="Setup conversation">
      <div className="kp-host-heading">
        <SetupMotionMark state={setupError ? "error" : conversation.motionState} />
        <div>
          <div className="kp-host-kicker">King's Press is guiding setup</div>
          <h2>{conversation.label}</h2>
        </div>
      </div>
      <div className="kp-host-messages">
        {(conversation.messages || []).map((message, index) => (
          <p key={index}>{message}</p>
        ))}
      </div>
      <div className="kp-host-choices" aria-label="Setup mode">
        <SetupChoiceChip label="Fast start" icon="play" active={mode === "fast"} onClick={() => onModeChange("fast")} />
        <SetupChoiceChip label="Guide me" icon="sparkle" active={mode === "guided"} onClick={() => onModeChange("guided")} />
        <SetupChoiceChip label="Type instead" icon="doc" active={mode === "text"} onClick={() => onModeChange("text")} />
        <SetupChoiceChip label="Voice optional" icon="mic" active={mode === "voice"} onClick={() => onModeChange("voice")} />
      </div>
      {!!results.length && (
        <div className="kp-action-timeline" aria-label="Recent setup actions">
          {results.map((result) => (
            <div key={(result.intent || "action") + (result.updatedAt || "")} data-status={result.status}>
              <span aria-hidden="true" />
              <p>
                <strong>{getActionStatusLabel(result.status)}</strong>
                <em>{(result.intent || "setup").replace(/_/g, " ")}</em>
              </p>
            </div>
          ))}
        </div>
      )}
      {setupError && <p className="kp-host-error" role="alert">{setupError}</p>}
    </aside>
  );
}

function SetupConversationCanvas({ conversation, mode, onModeChange, actionResults, setupError, conversationState }) {
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
  const results = Object.values(actionResults || {})
    .filter(Boolean)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0))
    .slice(-3);

  return (
    <section className="kp-conversation-canvas" aria-label="King's Press setup conversation">
      <div className="kp-conversation-toolbar">
        <div className="kp-conversation-host">
          <SetupMotionMark state={setupError ? "error" : conversation.motionState} />
          <div>
            <span>King's Press</span>
            <strong>{conversation.label}</strong>
          </div>
        </div>
        <div className="kp-conversation-mode" aria-label="Setup mode">
          <SetupChoiceChip label="Guide me" icon="sparkle" active={mode === "guided"} onClick={() => onModeChange("guided")} />
          <SetupChoiceChip label="Type" icon="doc" active={mode === "text"} onClick={() => onModeChange("text")} />
          <SetupChoiceChip label="Voice" icon="mic" active={mode === "voice"} onClick={() => onModeChange("voice")} />
        </div>
      </div>
      <div className="kp-conversation-thread">
        {(conversation.messages || []).map((message, index) => (
          <div key={"assistant-" + index} className="kp-chat-turn kp-chat-turn-assistant">
            <span className="kp-chat-avatar" aria-hidden="true">K</span>
            <p>{message}</p>
          </div>
        ))}
        {currentPrompt && (
          <div className="kp-chat-turn kp-chat-turn-assistant">
            <span className="kp-chat-avatar" aria-hidden="true">K</span>
            <p>{currentPrompt.question}</p>
          </div>
        )}
        {answeredTurns.map((turn) => (
          <div key={turn.id} className="kp-chat-turn kp-chat-turn-user">
            <p>{turn.text}</p>
          </div>
        ))}
      </div>
      {(!!results.length || setupError) && (
        <div className="kp-conversation-status" aria-live="polite">
          {results.map((result) => (
            <span key={(result.intent || "action") + (result.updatedAt || "")} data-status={result.status}>
              {getActionStatusLabel(result.status)}: {(result.intent || "setup").replace(/_/g, " ")}
            </span>
          ))}
          {setupError && <strong role="alert">{setupError}</strong>}
        </div>
      )}
    </section>
  );
}

function SetupShell({ children, conversation, mode, onModeChange, actionResults, setupError, centered, showHost, conversationState, onBack }) {
  const renderConversation = showHost !== false;
  return (
    <main className={"kp-setup-shell kp-setup-shell-canvas" + (centered ? " kp-setup-shell-centered" : "") + (!renderConversation ? " kp-setup-shell-hostless" : "")}>
      {renderConversation && (
        <SetupConversationCanvas
          conversation={conversation}
          mode={mode}
          onModeChange={onModeChange}
          actionResults={actionResults}
          setupError={setupError}
          conversationState={conversationState}
        />
      )}
      {onBack && (
        <div className="kp-setup-back-row">
          <button className="kp-setup-back" type="button" onClick={onBack} aria-label="Go back to the previous setup step">
            <span aria-hidden="true">←</span>
            Back
          </button>
        </div>
      )}
      <section className="kp-setup-stage">
        {children}
      </section>
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
      {transcript && (
        <p className="kp-transcript-preview" aria-live="polite">I heard: <strong>{transcript}</strong></p>
      )}
      <div className="kp-answer-actions">
        <button className="kp-setup-outline" type="button" onClick={onListen} disabled={disabled || listening} aria-pressed={listening ? "true" : "false"}>
          <Icon name="mic" size={16} /> {listening ? "Listening" : "Speak answer"}
        </button>
        <button className="kp-setup-primary" type="button" onClick={onSubmit} disabled={disabled || !String(value || "").trim()}>
          {actionLabel || "Use answer"} <Icon name="arrowR" size={20} />
        </button>
      </div>
      <SetupRepairChoices repair={repair} onChoose={onRepairChoose} />
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
  const [model, setModel] = React.useState((status && status.model) || "gpt-4o-mini");
  const [profileName, setProfileName] = React.useState("");
  const [listedModels, setListedModels] = React.useState([]);
  const [ollamaStatus, setOllamaStatus] = React.useState(null);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const cloudModels = {
    openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
    anthropic: ["claude-haiku-4-5", "claude-sonnet-4-5"],
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
    xai: ["grok-4.3", "grok-3-mini"],
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
  const profileIdFor = (profile) =>
    String([profile.provider, profile.baseUrl || "", profile.model].join("-"))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "llm-profile";

  React.useEffect(() => {
    if (!hasDesktop || !desktop.ollamaStatus) return;
    desktop.ollamaStatus().then(setOllamaStatus).catch(() => setOllamaStatus(null));
  }, [hasDesktop]);

  function applyMode(nextMode) {
    setMode(nextMode);
    setMessage("");
    if (nextMode === "ollama") {
      setProvider("ollama");
      setModel("llama3.2");
      return;
    }
    if (nextMode === "docker") {
      setProvider("openai-compatible");
      setBaseUrl(dockerUrl);
      setModel("");
      return;
    }
    setProvider("openai");
    setBaseUrl("");
    setModel("gpt-4o-mini");
  }

  function currentConfig() {
    if (mode === "ollama") return { provider: "ollama", model: model.trim(), baseUrl: "http://127.0.0.1:11434" };
    if (mode === "docker") return { provider: "openai-compatible", model: model.trim(), baseUrl: baseUrl.trim() || dockerUrl };
    return {
      provider,
      model: model.trim(),
      apiKey: apiKey.trim(),
      baseUrl: provider === "openai-compatible" ? baseUrl.trim() : providerBaseUrl(provider),
    };
  }

  async function listModels() {
    const config = currentConfig();
    setBusy(true);
    setMessage("Looking for models.");
    try {
      if (config.provider === "openai-compatible" && !config.baseUrl) throw new Error("Add a base URL first.");
      if (["openai", "anthropic", "gemini", "xai"].includes(config.provider) && !config.apiKey) throw new Error("Paste an API key first.");
      const response = await fetch("/api/llm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(config),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body && body.error) || "Could not load models.");
      const models = body && Array.isArray(body.models) ? body.models : [];
      setListedModels(models);
      if (models[0]) setModel(models[0]);
      setMessage(models.length ? "Models loaded." : "Provider responded, but no models were listed. You can still type one.");
    } catch (error) {
      setMessage((error && error.message) || "Could not load models. You can still type one.");
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

  async function testModel() {
    const config = currentConfig();
    if (!config.model) {
      setMessage("Choose or type a model first.");
      return;
    }
    setBusy(true);
    setMessage("Testing " + providerLabel(config.provider) + ".");
    try {
      const response = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(config),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error((body && body.error) || "The model test failed.");
      setMessage("Test passed.");
    } catch (error) {
      setMessage((error && error.message) || "The model test failed.");
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
    if (["openai", "anthropic", "gemini", "xai"].includes(config.provider) && !config.apiKey) {
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
    setMessage("Saving model settings.");
    try {
      const profile = Object.assign({}, config);
      profile.id = profileIdFor(profile);
      profile.label = profileName.trim() || providerLabel(profile.provider) + " " + profile.model;
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

  const options = mode === "ollama" ? ollamaModels : (listedModels.length ? listedModels : (cloudModels[provider] || []));
  const canList = mode !== "ollama";
  const currentStatus = status && status.provider && status.model
    ? providerLabel(status.provider) + " · " + status.model
    : "Not connected";

  return (
    <div className="kp-inline-model-setup">
      <div className="kp-inline-model-head">
        <span aria-hidden="true" className="kp-inline-model-icon"><Icon name="db" size={31} /></span>
        <div>
          <h3>AI & models</h3>
          <p>Choose the models King's Press can use to think and create.</p>
        </div>
        <SetupStatusChip label={currentStatus} />
      </div>
      <div className="kp-inline-model-tabs" role="group" aria-label="Model source">
        <button type="button" className={mode === "ollama" ? "active" : ""} onClick={() => applyMode("ollama")}>Ollama</button>
        <button type="button" className={mode === "docker" ? "active" : ""} onClick={() => applyMode("docker")}>Docker Model Runner</button>
        <button type="button" className={mode === "cloud" ? "active" : ""} onClick={() => applyMode("cloud")}>Cloud API key</button>
      </div>
      <div className="kp-inline-model-fields">
        {mode === "cloud" && (
          <>
            <label>
              <span>Provider</span>
              <select className="kp-setup-input" value={provider} onChange={(event) => {
                const next = event.target.value;
                setProvider(next);
                setModel((cloudModels[next] || [""])[0]);
                setBaseUrl(next === "openai-compatible" ? baseUrl : "");
              }}>
                <option value="openai">OpenAI / ChatGPT</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
                <option value="xai">xAI / Grok</option>
                <option value="openai-compatible">OpenAI-compatible</option>
              </select>
            </label>
            <label>
              <span>API key</span>
              <input className="kp-setup-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your API key" />
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
          <input className="kp-setup-input" value={model} onChange={(event) => setModel(event.target.value)} list="kp-inline-model-options" placeholder="model name" />
          <datalist id="kp-inline-model-options">{options.map((item) => <option key={item} value={item} />)}</datalist>
        </label>
      </div>
      <div className="kp-inline-model-actions">
        {mode === "ollama" && <button className="kp-setup-outline" type="button" disabled={busy || !model.trim()} onClick={pullModel}>Pull</button>}
        {canList && <button className="kp-setup-outline" type="button" disabled={busy} onClick={listModels}>List models</button>}
        <button className="kp-setup-outline" type="button" disabled={busy || !model.trim()} onClick={testModel}>Test</button>
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
        <button className="kp-setup-outline" type="button" onClick={onListen} disabled={listening} aria-pressed={listening ? "true" : "false"}>
          <Icon name="mic" size={16} /> {listening ? "Listening" : "Speak answer"}
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
  const providerLabels = {
    openai: "OpenAI",
    elevenlabs: "ElevenLabs",
    hedra: "Hedra",
  };
  const helpCopy = {
    openai: {
      title: "OpenAI is the simplest first key.",
      body: "Create a key in the OpenAI platform dashboard. Use it here for speech features, and King's Press can also use it as the starter LLM for the rest of onboarding.",
      url: "https://platform.openai.com/api-keys",
    },
    elevenlabs: {
      title: "ElevenLabs is for polished text-to-speech.",
      body: "Create an API key in ElevenLabs when you want higher-quality read-aloud voices for drafts, revisions, and outputs.",
      url: "https://elevenlabs.io/app/settings/api-keys",
    },
    hedra: {
      title: "Hedra is for avatar and video generation.",
      body: "Use Hedra when you want image, video, or talking-avatar production. It is helpful later in Studio, but it is not required for speech-to-text setup.",
      url: "https://www.hedra.com/",
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
      id: "openai-starter-gpt-4o-mini",
      label: "OpenAI / ChatGPT gpt-4o-mini",
      provider: "openai",
      model: "gpt-4o-mini",
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

  async function testVoiceKey() {
    setBusy(true);
    setMessage("Checking " + providerLabels[provider] + ".");
    try {
      let response;
      if (provider === "openai") {
        response = await fetch("/api/llm/test", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ provider: "openai", model: "gpt-4o-mini", apiKey: apiKey.trim() }),
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
        await saveOpenAIAsStarterLLM();
        await saveVoiceProviderKey();
        if (onVoiceConfigured) onVoiceConfigured({ provider, method: "api_key", saved: true });
        setMessage("OpenAI key works. I saved it encrypted for voice, setup, and drafting.");
      } else if (provider === "hedra") {
        const saved = await saveVoiceProviderKey();
        if (onVoiceConfigured) onVoiceConfigured({ provider, method: "api_key", saved });
        setMessage(saved ? "Hedra key works and was saved encrypted for Studio." : "Hedra key works. Open the desktop app to save it for Studio.");
      } else {
        const count = body && Array.isArray(body.voices) ? body.voices.length : 0;
        const saved = await saveVoiceProviderKey();
        if (onVoiceConfigured) onVoiceConfigured({ provider, method: "api_key", saved, voices: count });
        setMessage(saved
          ? "ElevenLabs key works and was saved encrypted. " + count + " voices available."
          : count ? "ElevenLabs key works. " + count + " voices available." : "ElevenLabs key works, but no voices were returned.");
      }
    } catch (error) {
      setMessage((error && error.message) || "Could not test this key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kp-inline-voice-setup">
      <div className="kp-inline-voice-head">
        <span aria-hidden="true" className="kp-inline-model-icon"><Icon name="mic" size={25} /></span>
        <div>
          <p className="kp-inline-step-label">Optional before the intro</p>
          <h3>Add voice if you want me to read aloud</h3>
          <p>Paste a voice API key and I can respond over audio. OpenAI is the easiest first key because it can also power the rest of setup.</p>
        </div>
        <SetupStatusChip label={connected ? "Connected" : "Optional"} />
      </div>
      <div className="kp-inline-voice-controls">
        <label>
          <span>Voice provider</span>
          <select className="kp-setup-input" value={provider} onChange={(event) => {
            setProvider(event.target.value);
            setMessage("");
          }}>
            <option value="openai">OpenAI voice + setup LLM</option>
            <option value="elevenlabs">ElevenLabs TTS</option>
            <option value="hedra">Hedra video/avatar</option>
          </select>
        </label>
        <label>
          <span>{providerLabels[provider]} API key</span>
          <input className="kp-setup-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your API key" />
        </label>
        <div className="kp-inline-voice-actions">
          <button className="kp-setup-outline" type="button" onClick={() => setHelpOpen((value) => !value)}>
            {helpOpen ? "Hide help" : "Get a key"}
          </button>
          <button className="kp-setup-outline" type="button" disabled={busy || !apiKey.trim()} onClick={testVoiceKey}>
            {busy ? "Testing" : provider === "openai" ? "Test + use" : "Test key"}
          </button>
          <button className="kp-setup-outline" type="button" disabled={audioState === "requesting_microphone"} onClick={onConnect}>
            {audioState === "requesting_microphone" ? "Connecting" : "Connect mic"}
          </button>
        </div>
      </div>
      {helpOpen && (
        <div className="kp-inline-provider-help">
          <strong>{helpCopy[provider].title}</strong>
          <p>{helpCopy[provider].body}</p>
          <a href={helpCopy[provider].url} target="_blank" rel="noreferrer">Open provider instructions</a>
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
  const [campaignName, setCampaignName] = React.useState("");
  const [prefDraft, setPrefDraft] = React.useState(null);
  const [draftStyle, setDraftStyle] = React.useState("Polished");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [audioState, setAudioState] = React.useState("audio_not_connected");
  const [audioError, setAudioError] = React.useState("");
  const [introVisible, setIntroVisible] = React.useState(false);
  const [integrationsTouched, setIntegrationsTouched] = React.useState(false);
  const [introAnswer, setIntroAnswer] = React.useState("");
  const [setupAnswer, setSetupAnswer] = React.useState("");
  const [setupTranscript, setSetupTranscript] = React.useState("");
  const [listening, setListening] = React.useState(false);
  const [repairState, setRepairState] = React.useState(null);
  const [platformAnswerCaptured, setPlatformAnswerCaptured] = React.useState(false);
  const [profileAnswer, setProfileAnswer] = React.useState("");
  const [setupProfileDraft, setSetupProfileDraft] = React.useState(null);
  const [profileBusy, setProfileBusy] = React.useState(false);
  const [focusActivation, setFocusActivation] = React.useState(null);
  const [conversationState, setConversationState] = React.useState(() => ONBOARDING_CONVERSATION.createState());
  const transcriptHandlerRef = React.useRef(null);
  const listenSessionRef = React.useRef(null);
  const setupStartedAtRef = React.useRef(Date.now());
  const metricsSessionIdRef = React.useRef(createSetupSessionId());
  const lastStepMetricRef = React.useRef(null);
  const voiceDecisionRef = React.useRef(false);
  const state = window.Store.getState();
  const campaigns = state.campaigns || [];
  const activeCampaign = window.Store.activeCampaign && window.Store.activeCampaign();
  const hasDesktopBridge = !!(window.KINGS_DESKTOP && window.KINGS_DESKTOP.isDesktop && window.KINGS_DESKTOP.isDesktop());
  const introScript = ONBOARDING_COPY.getPressIntroScript("kings_press");
  const quickPicks = Array.from(new Set([
    activeCampaign && activeCampaign.name,
    campaigns[0] && campaigns[0].name,
    "Launch plan",
    "Book draft",
    "New focus",
  ].filter(Boolean))).slice(0, 4);

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
      if (transcriptHandlerRef.current) transcriptHandlerRef.current(event.transcript || "");
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
  const connectRows = ONBOARDING_RUNTIME
    ? ONBOARDING_RUNTIME.getConnectItems({
      providerConnected,
      voiceConnected,
      voicePending: audioState === "requesting_microphone",
      integrationsTouched,
    })
    : [
      { id: "models", icon: "db", title: "AI & models", description: "Choose the models King's Press can use to think and create.", status: providerConnected ? "Connected" : "Not connected", label: "Set up" },
      { id: "voice", icon: "mic", title: "Voice", description: "Connect a microphone for voice input and guided setup.", status: voiceConnected ? "Connected" : "Optional", label: audioState === "requesting_microphone" ? "Connecting" : "Connect" },
      { id: "integrations", icon: "globe", title: "Integrations", description: "Bring in sources, media, and tools. You can add more anytime.", status: integrationsTouched ? "Optional" : "Not connected", label: "Explore" },
    ];

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
      setSetupTranscript(clean);
      showRepair(slotId, "focus", repair);
      return { needsRepair: true };
    }
    if (repair && repair.intent === "skip") {
      setSetupAnswer(clean);
      setSetupTranscript(clean);
      setRepairState(null);
      setConversationState((current) => ONBOARDING_CONVERSATION.skipSlot(current, slotId));
      recordAction(ONBOARDING_ACTIONS.SKIP_FOCUS, ONBOARDING_ACTION_STATUSES.SKIPPED);
      return { skipped: true };
    }
    setSetupAnswer(clean);
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
    recordAction(ONBOARDING_ACTIONS.PLAY_INTRO, ONBOARDING_ACTION_STATUSES.PENDING, {
      data: { waitingForWelcomeStep: true },
    });
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
      const selfStatement = profile.selfStatement || (profile.voiceProfile && profile.voiceProfile.userDescription) || "";
      const rules = (profile.voiceRules || []).join("\n");
      const redLines = (profile.redLines || []).join("\n");
      return Object.assign({}, seeded, {
        selfVision: seeded.selfVision || selfStatement,
        audienceName: seeded.audienceName || profile.primaryAudience || "",
        throughlineName: seeded.throughlineName || profile.throughline || "",
        voiceRules: seeded.voiceRules || rules,
        redLines: seeded.redLines || redLines,
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
          brand: "kings_press",
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

  function handleTranscript(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    if (step === 0) {
      handleIntroConsentAnswer(clean, "voice");
      return;
    }
    if (step === 1) {
      handleVoiceSetupAnswer(clean, "voice");
      return;
    }
    if (step === 3) {
      applyPlatformAnswer(clean, "voice");
      return;
    }
    if (step === 4) {
      interpretProfileAnswer(clean, "voice");
    }
  }

  transcriptHandlerRef.current = handleTranscript;

  function listenForAnswer() {
    setSetupError("");
    stopListeningSession();
    setListening(true);
    const session = ONBOARDING_AUDIO.listenOnce && ONBOARDING_AUDIO.listenOnce({
      onFinal: (transcript) => {
        setSetupTranscript(transcript);
        handleTranscript(transcript);
      },
      onError: (error) => {
        setSetupError((error && error.message) || "Speech recognition is not available here. You can type instead.");
        listenSessionRef.current = null;
        setListening(false);
      },
      onEnd: () => {
        listenSessionRef.current = null;
        setListening(false);
      },
    });
    if (!session || !session.supported) {
      listenSessionRef.current = null;
      setListening(false);
      setSetupError("Speech recognition is not available here. You can type instead.");
      return;
    }
    listenSessionRef.current = session;
  }

  function stopListeningSession(updateState = true) {
    if (listenSessionRef.current && listenSessionRef.current.stop) {
      try { listenSessionRef.current.stop(); } catch (_err) {}
    }
    listenSessionRef.current = null;
    if (updateState) setListening(false);
  }

  function runConnectAction(item) {
    if (item.id === "models") {
      recordAction(ONBOARDING_ACTIONS.OPEN_PROVIDER_SETUP, ONBOARDING_ACTION_STATUSES.PENDING);
      const action = ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.openProviderSetup
        ? ONBOARDING_ACTION_REGISTRY.openProviderSetup({ onOpenProviderSetup })
        : Promise.resolve(null);
      action.then((result) => {
        if (!result) return;
        recordAction(result.intent || ONBOARDING_ACTIONS.OPEN_PROVIDER_SETUP, result.status, result);
        if (result.status === ONBOARDING_ACTION_STATUSES.FAILED) setSetupError(result.error || "Could not open model setup.");
      });
      return;
    }
    if (item.id === "voice") {
      connectAudio();
      return;
    }
    if (item.id === "integrations") {
      const action = ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.exploreIntegrations
        ? ONBOARDING_ACTION_REGISTRY.exploreIntegrations()
        : Promise.resolve({ status: ONBOARDING_ACTION_STATUSES.SKIPPED, data: { reason: "connect_later" } });
      action.then((result) => {
        setIntegrationsTouched(true);
        recordAction(ONBOARDING_ACTIONS.EXPLORE_INTEGRATIONS, result.status || ONBOARDING_ACTION_STATUSES.SKIPPED, result);
      });
    }
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
    if (voiceConnected) {
      await ONBOARDING_AUDIO.speakText(introScript, { interrupt: true });
    }
    recordAction(ONBOARDING_ACTIONS.PLAY_INTRO, ONBOARDING_ACTION_STATUSES.SUCCEEDED);
  }

  async function continueFromVoice() {
    if (!voiceSetupHasDecision()) {
      if (voiceConnected) captureVoiceSetupAnswer("microphone connected", "button");
      else skipVoiceSetup();
    }
    if (introAccepted && voiceConnected) {
      setIntroVisible(true);
      recordAction(ONBOARDING_ACTIONS.PLAY_INTRO, ONBOARDING_ACTION_STATUSES.PENDING);
      try {
        await ONBOARDING_AUDIO.speakText(introScript, { interrupt: true });
        recordAction(ONBOARDING_ACTIONS.PLAY_INTRO, ONBOARDING_ACTION_STATUSES.SUCCEEDED);
      } catch (error) {
        recordAction(ONBOARDING_ACTIONS.PLAY_INTRO, ONBOARDING_ACTION_STATUSES.FAILED, {
          error: (error && error.message) || "Could not read the orientation aloud.",
        });
      }
    }
    goToStep(2);
  }

  async function ensureFocus(nameOverride) {
    const clean = String(nameOverride || campaignName || "").trim();
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
      const setupTranscriptPayload = ONBOARDING_CONVERSATION && ONBOARDING_CONVERSATION.transcriptForState
        ? ONBOARDING_CONVERSATION.transcriptForState(conversationState)
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
        .kp-choice-chip:focus-visible {
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
          margin-top: 76px;
          display: grid;
          grid-template-columns: minmax(280px, 0.82fr) minmax(0, 1.65fr);
          gap: clamp(34px, 5vw, 72px);
          align-items: start;
        }
        .kp-setup-shell-centered {
          align-items: center;
          min-height: calc(100vh - 286px);
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
          gap: 34px;
          margin-top: 54px;
        }
        .kp-setup-shell-canvas .kp-setup-stage {
          width: min(980px, 100%);
          justify-self: center;
        }
        .kp-setup-back-row {
          width: min(980px, 100%);
          justify-self: center;
          margin: -2px 0 -8px;
        }
        .kp-setup-back {
          min-height: 40px;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          border: 1px solid rgba(216, 206, 195, 0.84);
          border-radius: 999px;
          background: rgba(255, 252, 246, 0.58);
          color: #766A63;
          padding: 7px 15px;
          font: 15px var(--font-sans);
          cursor: pointer;
          transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
        }
        .kp-setup-back:hover {
          color: #A74732;
          border-color: rgba(167, 71, 50, 0.46);
          background: rgba(255, 252, 246, 0.88);
        }
        .kp-setup-back:focus-visible {
          outline: 3px solid rgba(167, 71, 50, 0.22);
          outline-offset: 3px;
        }
        .kp-setup-shell-canvas.kp-setup-shell-centered {
          align-items: start;
          min-height: 0;
        }
        .kp-conversation-canvas {
          width: min(980px, 100%);
          justify-self: center;
          border: 1px solid rgba(216, 206, 195, 0.74);
          border-radius: 18px;
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
        .kp-conversation-host > div {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .kp-conversation-host span {
          color: #766A63;
          font-size: 12px;
        }
        .kp-conversation-host strong {
          color: #2A211E;
          font: 21px var(--font-serif);
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .kp-conversation-mode {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
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
          background: rgba(167, 71, 50, 0.10);
          color: #A74732;
          font: 16px var(--font-serif);
          flex: 0 0 auto;
        }
        .kp-conversation-status {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 0 20px 18px;
        }
        .kp-conversation-status span,
        .kp-conversation-status strong {
          min-height: 30px;
          display: inline-flex;
          align-items: center;
          border: 1px solid #D8CEC3;
          border-radius: 999px;
          background: rgba(255, 252, 246, 0.74);
          color: #766A63;
          padding: 4px 11px;
          font-size: 12.5px;
          font-weight: 400;
        }
        .kp-conversation-status span[data-status="succeeded"] { color: #5E7A46; }
        .kp-conversation-status span[data-status="failed"],
        .kp-conversation-status strong { color: #A74732; }
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
        .kp-host-heading h2 {
          margin: 3px 0 0;
          font: 24px var(--font-serif);
          color: #2A211E;
        }
        .kp-host-kicker {
          color: #766A63;
          font-size: 12px;
        }
        .kp-host-orb {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: rgba(167, 71, 50, 0.10);
          flex-shrink: 0;
        }
        .kp-host-orb > span {
          width: 14px;
          height: 14px;
          border-radius: 999px;
          background: #A74732;
          box-shadow: 0 0 0 0 rgba(167, 71, 50, 0.26);
        }
        .kp-host-orb-listening > span,
        .kp-host-orb-speaking > span,
        .kp-host-orb-thinking > span {
          animation: kpHostPulse 1.45s ease-in-out infinite;
        }
        .kp-host-orb-error {
          background: rgba(167, 71, 50, 0.16);
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
        .kp-host-choices {
          margin-top: 20px;
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
        }
        .kp-choice-chip {
          min-height: 38px;
          border: 1px solid #D8CEC3;
          border-radius: 999px;
          background: rgba(255, 252, 246, 0.7);
          color: #766A63;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 13px;
          font: 14.5px var(--font-body);
          cursor: pointer;
        }
        .kp-choice-chip[data-active="true"] {
          border-color: #A74732;
          color: #A74732;
          background: rgba(167, 71, 50, 0.055);
        }
        .kp-action-timeline {
          margin-top: 22px;
          padding-top: 18px;
          border-top: 1px solid rgba(216, 206, 195, 0.78);
          display: grid;
          gap: 12px;
        }
        .kp-action-timeline div {
          display: grid;
          grid-template-columns: 12px minmax(0, 1fr);
          gap: 10px;
          align-items: start;
        }
        .kp-action-timeline div > span {
          width: 9px;
          height: 9px;
          margin-top: 5px;
          border-radius: 999px;
          background: #766A63;
        }
        .kp-action-timeline div[data-status="succeeded"] > span { background: #5E7A46; }
        .kp-action-timeline div[data-status="failed"] > span { background: #A74732; }
        .kp-action-timeline div[data-status="pending"] > span { background: #B9894C; animation: kpHostPulse 1.2s ease-in-out infinite; }
        .kp-action-timeline p {
          margin: 0;
          display: grid;
          gap: 2px;
        }
        .kp-action-timeline strong {
          font-size: 13px;
          color: #2A211E;
        }
        .kp-action-timeline em {
          font-style: normal;
          color: #766A63;
          font-size: 12.5px;
        }
        .kp-inline-model-setup {
          padding: 24px 34px 26px;
          display: grid;
          gap: 13px;
        }
        .kp-inline-intro-consent {
          padding: 24px 34px;
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
          padding: 24px 34px 26px;
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
        .kp-inline-voice-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          justify-content: flex-end;
        }
        .kp-inline-voice-actions .kp-setup-outline {
          min-height: 40px;
          font-size: 15.5px;
          padding: 0 16px;
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
          margin: 34px auto 0;
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
        @keyframes kpHostPulse {
          0% { transform: scale(0.92); box-shadow: 0 0 0 0 rgba(167, 71, 50, 0.24); }
          70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(167, 71, 50, 0); }
          100% { transform: scale(0.92); box-shadow: 0 0 0 0 rgba(167, 71, 50, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .kp-host-orb > span,
          .kp-action-timeline div[data-status="pending"] > span {
            animation: none;
          }
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
          .kp-conversation-mode {
            justify-content: flex-start;
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
          .kp-inline-voice-controls,
          .kp-inline-intro-copy { padding-left: 0; margin-left: 0; }
          .kp-inline-model-fields,
          .kp-inline-voice-controls { grid-template-columns: 1fr; }
          .kp-inline-intro-consent { grid-template-columns: 1fr; }
          .kp-inline-model-actions,
          .kp-inline-voice-actions,
          .kp-inline-intro-actions { justify-content: flex-start; }
        }
      `}</style>
      <div style={{ width: "min(1120px, calc(100% - 72px))", margin: "0 auto", padding: "44px 0 34px" }}>
        <OnboardingBrand />
        <OnboardingStepper step={step} />

        {step === 0 && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} actionResults={actionResults} setupError={setupError} conversationState={conversationState} centered hostless>
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
                onListen={listenForAnswer}
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
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} actionResults={actionResults} setupError={setupError} conversationState={conversationState} onBack={() => goToStep(0)}>
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
              secondary="Skip voice"
              onSecondary={() => {
                skipVoiceSetup();
                goToStep(2);
              }}
              primary="Continue"
              onPrimary={continueFromVoice}
            />
            <SetupReassurance />
          </SetupShell>
        )}

        {step === 2 && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} actionResults={actionResults} setupError={setupError} conversationState={conversationState} onBack={() => goToStep(1)}>
            <section style={{
              border: "1px solid #D8CEC3", borderRadius: 10, background: "rgba(255, 252, 246, 0.68)",
              overflow: "hidden",
            }}>
              <InlineModelSetup
                status={providerStatus}
                onSaved={(profile) => setProviderStatus((current) => Object.assign({}, current || {}, {
                  provider: profile && profile.provider,
                  model: profile && profile.model,
                }))}
              />
              {connectRows.filter((item) => item.id !== "models" && item.id !== "voice").map((item) => (
                <SetupPanelRow
                  key={item.id}
                  icon={item.icon}
                  title={item.title}
                  description={item.description}
                  status={item.status}
                  action={item.label}
                  onClick={() => runConnectAction(item)}
                  disabled={item.pending}
                />
              ))}
            </section>
            {setupError && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{setupError}</p>
            )}
            <SetupActions
              secondary="Skip setup"
              onSecondary={skip}
              primary="Continue"
              onPrimary={() => goToStep(3)}
            />
            <SetupReassurance />
          </SetupShell>
        )}

        {step === 3 && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} actionResults={actionResults} setupError={setupError} conversationState={conversationState} onBack={() => goToStep(2)}>
            <SetupAnswerComposer
              question={focusPrompt && focusPrompt.question}
              helper={focusPrompt && focusPrompt.helper}
              value={setupAnswer}
              onChange={setSetupAnswer}
              onSubmit={() => applyPlatformAnswer(setupAnswer, "typed")}
              onListen={listenForAnswer}
              listening={listening}
              transcript={platformAnswerCaptured ? setupTranscript : ""}
              placeholder={focusPrompt && focusPrompt.placeholder}
              actionLabel={focusPrompt && focusPrompt.actionLabel}
              repair={repairState && repairState.slotId === ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS ? repairState : null}
              onRepairChoose={(suggestion) => {
                const next = (suggestion && suggestion.value) || "";
                setSetupAnswer(next);
                const result = applyPlatformAnswer(next, "button");
                if (result && result.skipped) goToStep(4);
              }}
            />
            {platformAnswerCaptured && (
              <p style={{ margin: "14px 0 0", color: "#5E7A46", fontSize: 15 }}>
                Got it. I used that to shape your first focus and setup notes.
              </p>
            )}
            <div style={{ height: 34 }} />
            <SetupField label="First project or campaign name" helper="You can rename this anytime.">
              <input
                className="kp-setup-input"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") ensureFocus().then(() => goToStep(4)); }}
                placeholder="e.g. Smoke Test"
                style={{ fontFamily: "var(--font-serif)", fontSize: 25, height: 75 }}
              />
            </SetupField>
            <div style={{ marginTop: 62 }}>
              <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 25, fontWeight: 500 }}>Quick picks</h2>
              <p style={{ margin: "10px 0 28px", color: "#766A63", fontSize: 18 }}>Start with one of your recent focuses.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 22 }}>
                {quickPicks.map((pick, i) => (
                  <button
                    key={pick}
                    className="kp-chip"
                    data-active={campaignName === pick}
                    onClick={() => setCampaignName(pick === "New focus" ? "" : pick)}
                  >
                    <Icon name={i === 0 ? "sparkle" : pick === "Book draft" ? "book" : pick === "New focus" ? "plus" : "play"} size={21} />
                    {pick}
                  </button>
                ))}
              </div>
            </div>
            <SetupActions
              secondary="Skip for now"
              onSecondary={() => {
                setConversationState((current) => ONBOARDING_CONVERSATION.skipSlot(current, ONBOARDING_CONVERSATION.SLOT_IDS.COMMUNICATION_PLATFORMS));
                recordAction(ONBOARDING_ACTIONS.SKIP_FOCUS, ONBOARDING_ACTION_STATUSES.SKIPPED);
                goToStep(4);
              }}
              primary="Continue"
              busy={busy}
              onPrimary={() => {
                const applied = setupAnswer.trim() && !platformAnswerCaptured
                  ? applyPlatformAnswer(setupAnswer, "typed")
                  : null;
                if (applied && (applied.skipped || applied.needsRepair)) {
                  if (applied.skipped) goToStep(4);
                  return;
                }
                ensureFocus(applied && applied.focusName).then(() => goToStep(4)).catch(() => null);
              }}
            />
            {setupError && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{setupError}</p>
            )}
            <SetupReassurance />
          </SetupShell>
        )}

        {step === 4 && prefDraft && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} actionResults={actionResults} setupError={setupError} conversationState={conversationState} onBack={() => goToStep(3)}>
            <SetupAnswerComposer
              question={preferencesPrompt && preferencesPrompt.question}
              helper={preferencesPrompt && preferencesPrompt.helper}
              value={profileAnswer}
              onChange={setProfileAnswer}
              onListen={listenForAnswer}
              listening={listening}
              disabled={profileBusy}
              transcript={step === 4 ? setupTranscript : ""}
              placeholder={preferencesPrompt && preferencesPrompt.placeholder}
              actionLabel={profileBusy ? "Interpreting" : "Use for defaults"}
              onSubmit={() => interpretProfileAnswer(profileAnswer, "typed")}
              repair={repairState && repairState.slotId === ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE ? repairState : null}
              onRepairChoose={(suggestion) => {
                const next = (suggestion && suggestion.value) || "";
                setProfileAnswer(next);
                interpretProfileAnswer(next, "button");
              }}
            />
            <div style={{ height: 28 }} />
            <SetupProfileReview profile={setupProfileDraft} />
            <section style={{
              border: "1px solid #D8CEC3", borderRadius: 10, background: "rgba(255, 252, 246, 0.64)",
              overflow: "hidden",
            }}>
              <div style={{ padding: "30px 30px 28px", display: "grid", gap: 30 }}>
                <SetupField label="Your voice" helper="Who you are, what you stand for, and how the desk should sound.">
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
                  <SetupField label="Primary audience">
                    <input
                      className="kp-setup-input"
                      value={prefDraft.audienceName}
                      onChange={(e) => setPrefDraft({ ...prefDraft, audienceName: e.target.value })}
                      placeholder="e.g. Independent operators"
                    />
                  </SetupField>
                  <SetupField label="Throughline">
                    <input
                      className="kp-setup-input"
                      value={prefDraft.throughlineName}
                      onChange={(e) => setPrefDraft({ ...prefDraft, throughlineName: e.target.value })}
                      placeholder="e.g. Core insight or point of view"
                    />
                  </SetupField>
                </div>
                <div>
                  <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500 }}>Draft style</h2>
                  <p style={{ margin: "8px 0 12px", color: "#766A63", fontSize: 16 }}>How should default drafts come through?</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 20 }}>
                    {["Polished", "Plainspoken", "Strategic", "Conversational"].map((option) => (
                      <button
                        key={option}
                        className="kp-segment"
                        data-active={draftStyle === option}
                        onClick={() => {
                          setDraftStyle(option);
                          setPrefDraft({ ...prefDraft, registerBody: "Default draft style: " + option.toLowerCase() + "." });
                        }}
                      >
                        {draftStyle === option && <Icon name="check" size={16} style={{ marginRight: 10 }} />}
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
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
                    <span style={{ display: "block", marginTop: 5, color: "#766A63", fontSize: 16 }}>Tone rules, do-nots, and custom preferences.</span>
                  </span>
                  <Icon name="chevD" size={22} style={{ transform: advancedOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                </button>
                {advancedOpen && (
                  <div style={{ padding: "0 30px 30px", display: "grid", gap: 22 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 22 }}>
                      <SetupField label="Point-of-view tag">
                        <input className="kp-setup-input" value={prefDraft.throughlineTag} onChange={(e) => setPrefDraft({ ...prefDraft, throughlineTag: e.target.value })} placeholder="core" />
                      </SetupField>
                      <SetupField label="Audience key">
                        <input className="kp-setup-input" value={prefDraft.audienceId} onChange={(e) => setPrefDraft({ ...prefDraft, audienceId: e.target.value })} placeholder="general" />
                      </SetupField>
                    </div>
                    <SetupField label="Point-of-view note">
                      <textarea className="kp-setup-input" value={prefDraft.throughlineNote} onChange={(e) => setPrefDraft({ ...prefDraft, throughlineNote: e.target.value })} rows={3} />
                    </SetupField>
                    <SetupField label="Strategy note">
                      <textarea className="kp-setup-input" value={prefDraft.strategy} onChange={(e) => setPrefDraft({ ...prefDraft, strategy: e.target.value })} rows={3} />
                    </SetupField>
                    <SetupField label="Audience note">
                      <textarea className="kp-setup-input" value={prefDraft.audienceNote} onChange={(e) => setPrefDraft({ ...prefDraft, audienceNote: e.target.value })} rows={3} />
                    </SetupField>
                    <SetupField label="Drafting notes">
                      <textarea className="kp-setup-input" value={prefDraft.registerBody} onChange={(e) => setPrefDraft({ ...prefDraft, registerBody: e.target.value })} rows={3} />
                    </SetupField>
                    <SetupField label="Tone rules">
                      <textarea className="kp-setup-input" value={prefDraft.voiceRules} onChange={(e) => setPrefDraft({ ...prefDraft, voiceRules: e.target.value })} rows={3} placeholder="One rule per line." />
                    </SetupField>
                    <SetupField label="Do-nots">
                      <textarea className="kp-setup-input" value={prefDraft.redLines} onChange={(e) => setPrefDraft({ ...prefDraft, redLines: e.target.value })} rows={3} placeholder="One constraint per line." />
                    </SetupField>
                    <SetupField label="Editorial guardrails">
                      <textarea className="kp-setup-input" value={prefDraft.gateSpec} onChange={(e) => setPrefDraft({ ...prefDraft, gateSpec: e.target.value })} rows={4} placeholder="e.g. Be strict on unsupported claims, gentle on voice, and flag anything that sounds generic." />
                    </SetupField>
                  </div>
                )}
              </div>
            </section>
            <SetupActions
              secondary="Do this later"
              onSecondary={() => {
                setConversationState((current) => ONBOARDING_CONVERSATION.skipSlot(current, ONBOARDING_CONVERSATION.SLOT_IDS.VOICE_PROFILE));
                finish({ skipPreferences: true });
              }}
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
