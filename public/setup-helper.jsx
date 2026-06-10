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
const ONBOARDING_STEPS = (ONBOARDING_RUNTIME && ONBOARDING_RUNTIME.steps) || [
  { id: "connect", label: "Connect" },
  { id: "welcome", label: "Welcome" },
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
      display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", alignItems: "center",
      gap: 14, marginTop: 72, color: "#766A63",
    }}>
      {ONBOARDING_STEPS.map((item, i) => {
        const label = item.label;
        const active = step === i;
        const done = i < step;
        return (
          <div key={label} aria-current={active ? "step" : undefined} style={{
            display: "grid", gridTemplateColumns: "auto auto minmax(24px, 1fr)", alignItems: "center",
            gap: 14, minWidth: 0,
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
              fontFamily: "var(--font-serif)", fontSize: 18, whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}>{label}</span>
            {i < ONBOARDING_STEPS.length - 1 && <span aria-hidden="true" style={{
              height: 1, minWidth: 24, background: "#D8CEC3", opacity: 0.9,
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

function SetupShell({ children, conversation, mode, onModeChange, actionResults, setupError, centered }) {
  return (
    <main className={"kp-setup-shell" + (centered ? " kp-setup-shell-centered" : "")}>
      <SetupHostPanel
        conversation={conversation}
        mode={mode}
        onModeChange={onModeChange}
        actionResults={actionResults}
        setupError={setupError}
      />
      <section className="kp-setup-stage">
        {children}
      </section>
    </main>
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

  if (!open) return null;

  const currentStep = ONBOARDING_STEPS[step] || ONBOARDING_STEPS[0];
  const conversation = ONBOARDING_RUNTIME && ONBOARDING_RUNTIME.getStepConversation
    ? ONBOARDING_RUNTIME.getStepConversation(currentStep.id)
    : { id: currentStep.id, label: currentStep.label, messages: [], suggestions: [], motionState: "idle" };
  const providerConnected = !!(providerStatus && providerStatus.provider && providerStatus.model);
  const voiceConnected = audioState === "audio_ready";
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
    setStep(ONBOARDING_RUNTIME ? ONBOARDING_RUNTIME.clampStepIndex(next) : Math.max(0, Math.min(3, next)));
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
      recordAction(ONBOARDING_ACTIONS.REQUEST_VOICE, ONBOARDING_ACTION_STATUSES.SUCCEEDED, result || undefined);
    } catch (e) {
      setAudioState("error");
      const message = (e && e.message) || "Audio setup failed. You can continue by typing.";
      setAudioError(message);
      recordAction(ONBOARDING_ACTIONS.REQUEST_VOICE, ONBOARDING_ACTION_STATUSES.FAILED, { error: message });
    }
  }

  async function introduce() {
    setIntroVisible(true);
    recordAction(ONBOARDING_ACTIONS.PLAY_INTRO, ONBOARDING_ACTION_STATUSES.PENDING);
    if (voiceConnected) {
      await ONBOARDING_AUDIO.speakText(introScript, { interrupt: true });
    }
    recordAction(ONBOARDING_ACTIONS.PLAY_INTRO, ONBOARDING_ACTION_STATUSES.SUCCEEDED);
  }

  async function ensureFocus() {
    const clean = campaignName.trim();
    if (activeCampaign && (!clean || clean === activeCampaign.name)) return activeCampaign.id;
    const name = clean || "Untitled focus";
    setBusy(true);
    recordAction(ONBOARDING_ACTIONS.SAVE_FOCUS, ONBOARDING_ACTION_STATUSES.PENDING);
    try {
      if (ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.saveFocus) {
        const result = await ONBOARDING_ACTION_REGISTRY.saveFocus(name, { activeCampaign });
        if (result.status === ONBOARDING_ACTION_STATUSES.FAILED) throw new Error(result.error);
        recordAction(ONBOARDING_ACTIONS.SAVE_FOCUS, ONBOARDING_ACTION_STATUSES.SUCCEEDED, result);
        return result.data && result.data.campaignId;
      }
      const tempId = window.Store.addCampaign(name);
      if (window.Store.whenCampaignSaved) await window.Store.whenCampaignSaved(tempId);
      recordAction(ONBOARDING_ACTIONS.SAVE_FOCUS, ONBOARDING_ACTION_STATUSES.SUCCEEDED, { data: { campaignId: tempId } });
      return tempId;
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
      ("Default draft style: " + draftStyle.toLowerCase() + ".");
    const patch = {
      strategy: Object.assign({}, refs.strategy || {}, {
        body: prefDraft.strategy,
        throughlines: throughline.name || throughline.note
          ? [throughline].concat(strategyList.slice(1))
          : strategyList,
      }),
      audiences: Object.assign({}, refs.audiences || {}, {
        list: audience.name || audience.note ? [audience].concat(audienceList.slice(1)) : audienceList,
      }),
      registers: Object.assign({}, refs.registers || {}, { body: registerBody }),
      voiceRules: Object.assign({}, refs.voiceRules || {}, {
        rules: prefDraft.voiceRules.split("\n").map((x) => x.trim()).filter(Boolean),
      }),
      redLines: Object.assign({}, refs.redLines || {}, {
        rules: prefDraft.redLines.split("\n").map((x) => x.trim()).filter(Boolean),
      }),
      selfVision: Object.assign({}, refs.selfVision || {}, { body: prefDraft.selfVision }),
      gateSpec: Object.assign({}, refs.gateSpec || {}, { body: prefDraft.gateSpec }),
    };
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

  const finish = async () => {
    setSetupError("");
    setBusy(true);
    try {
      if (!activeCampaign && campaignName.trim()) await ensureFocus();
      await savePreferences();
      if (ONBOARDING_ACTION_REGISTRY && ONBOARDING_ACTION_REGISTRY.completeOnboarding) {
        const result = await ONBOARDING_ACTION_REGISTRY.completeOnboarding({ firstValueComplete: true });
        if (result.status === ONBOARDING_ACTION_STATUSES.FAILED) throw new Error(result.error);
        recordAction(ONBOARDING_ACTIONS.COMPLETE_ONBOARDING, ONBOARDING_ACTION_STATUSES.SUCCEEDED, result);
      } else {
        recordAction(ONBOARDING_ACTIONS.COMPLETE_ONBOARDING, ONBOARDING_ACTION_STATUSES.SUCCEEDED);
      }
      if (onComplete) onComplete();
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
        .kp-host-error {
          margin: 18px 0 0;
          color: #A74732;
          font-size: 14px;
          line-height: 1.45;
        }
        .kp-setup-stage {
          min-width: 0;
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
          .kp-host-panel {
            position: static;
          }
          .kp-setup-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div style={{ width: "min(1120px, calc(100% - 72px))", margin: "0 auto", padding: "44px 0 34px" }}>
        <OnboardingBrand />
        <OnboardingStepper step={step} />

        {step === 0 && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} actionResults={actionResults} setupError={setupError}>
            <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: "clamp(50px, 6vw, 76px)", fontWeight: 500, lineHeight: 1.04 }}>
              Let's set up your desk
            </h1>
            <p style={{ margin: "22px 0 42px", color: "#766A63", fontSize: 21, lineHeight: 1.5 }}>
              Choose what to connect now. You can skip anything and change it later.
            </p>
            <section style={{
              border: "1px solid #D8CEC3", borderRadius: 10, background: "rgba(255, 252, 246, 0.68)",
              overflow: "hidden",
            }}>
              {connectRows.map((item) => (
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
            {audioState === "error" && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{audioError}</p>
            )}
            {setupError && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{setupError}</p>
            )}
            <SetupActions
              secondary="Skip setup"
              onSecondary={skip}
              primary="Continue"
              onPrimary={() => goToStep(1)}
            />
            <SetupReassurance />
          </SetupShell>
        )}

        {step === 1 && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} actionResults={actionResults} setupError={setupError} centered>
            <div style={{ width: "min(660px, 100%)" }}>
              <div style={{
                color: "#766A63", fontSize: 13, letterSpacing: "0.34em", textTransform: "uppercase",
                marginBottom: 25,
              }}>Welcome</div>
              <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: "clamp(46px, 5vw, 66px)", fontWeight: 500, lineHeight: 1.08 }}>
                May I introduce myself?
              </h1>
              {!introVisible ? (
                <>
                  <p style={{ margin: "30px auto 0", maxWidth: 560, color: "#766A63", fontFamily: "var(--font-serif)", fontSize: 27, lineHeight: 1.38 }}>
                    I'm King's Press—your desk for turning ideas into clear, publishable work.
                  </p>
                  <p style={{ margin: "30px auto 0", maxWidth: 540, color: "#766A63", fontFamily: "var(--font-serif)", fontSize: 21, lineHeight: 1.42 }}>
                    I'll help you think, draft, refine, and prepare your work so it's ready to be read and remembered.
                  </p>
                  {!voiceConnected && (
                    <p style={{
                      margin: "36px auto 0", paddingTop: 27, borderTop: "1px solid #D8CEC3",
                      maxWidth: 430, color: "#766A63", fontSize: 17, lineHeight: 1.5,
                      display: "flex", gap: 12, alignItems: "flex-start", textAlign: "left",
                    }}>
                      <Icon name="warn" size={18} style={{ color: "#A74732", flexShrink: 0, marginTop: 3 }} />
                      Voice is not connected yet, so I'll keep my introduction on screen. You can still type your setup answers.
                    </p>
                  )}
                  <div style={{ marginTop: 44, display: "grid", justifyItems: "center", gap: 22 }}>
                    <button className="kp-setup-primary" onClick={introduce} style={{ minWidth: 330 }}>
                      Yes, introduce yourself
                    </button>
                    <button className="kp-setup-link" onClick={() => {
                      recordAction(ONBOARDING_ACTIONS.SKIP_INTRO, ONBOARDING_ACTION_STATUSES.SKIPPED);
                      goToStep(2);
                    }}>Skip for now</button>
                  </div>
                </>
              ) : (
                <>
                  <pre style={{
                    whiteSpace: "pre-wrap", margin: "34px auto 0", maxWidth: 680,
                    color: "#766A63", font: "20px/1.68 var(--font-serif)", textAlign: "center",
                  }}>{introScript}</pre>
                  <div style={{ marginTop: 42, display: "grid", justifyItems: "center", gap: 18 }}>
                    <button className="kp-setup-primary" onClick={() => goToStep(2)}>Continue <Icon name="arrowR" size={22} /></button>
                    <button className="kp-setup-link" onClick={() => {
                      recordAction(ONBOARDING_ACTIONS.SKIP_INTRO, ONBOARDING_ACTION_STATUSES.SKIPPED);
                      goToStep(2);
                    }}>Skip for now</button>
                  </div>
                </>
              )}
            </div>
          </SetupShell>
        )}

        {step === 2 && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} actionResults={actionResults} setupError={setupError}>
            <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: "clamp(46px, 5.3vw, 66px)", fontWeight: 500, lineHeight: 1.08 }}>
              What are you working on first?
            </h1>
            <p style={{ margin: "24px 0 54px", maxWidth: 680, color: "#766A63", fontFamily: "var(--font-serif)", fontSize: 27, lineHeight: 1.38 }}>
              Your first focus helps organize drafts, sources, Gather runs, and notes in one place.
            </p>
            <SetupField label="First project or campaign name" helper="You can rename this anytime.">
              <input
                className="kp-setup-input"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") ensureFocus().then(() => goToStep(3)); }}
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
                recordAction(ONBOARDING_ACTIONS.SKIP_FOCUS, ONBOARDING_ACTION_STATUSES.SKIPPED);
                goToStep(3);
              }}
              primary="Continue"
              busy={busy}
              onPrimary={() => ensureFocus().then(() => goToStep(3)).catch(() => null)}
            />
            {setupError && (
              <p role="alert" style={{ margin: "16px 0 0", color: "#A74732", fontSize: 15.5 }}>{setupError}</p>
            )}
            <SetupReassurance />
          </SetupShell>
        )}

        {step === 3 && prefDraft && (
          <SetupShell conversation={conversation} mode={setupMode} onModeChange={setSetupMode} actionResults={actionResults} setupError={setupError}>
            <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: "clamp(52px, 5.8vw, 76px)", fontWeight: 500, lineHeight: 1.04 }}>
              Set your defaults
            </h1>
            <p style={{ margin: "22px 0 34px", color: "#766A63", fontSize: 21, lineHeight: 1.5 }}>
              Start with the basics. You can refine everything later.
            </p>
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
              onSecondary={finish}
              primary="Finish setup"
              onPrimary={finish}
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
