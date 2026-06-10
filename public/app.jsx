/* App root — topbar, routing, role + theme, and the piece Workspace
   that orchestrates the sequential gate run. */

function useStore() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => window.Store.subscribe(force), []);
  return window.Store.getState();
}

function EditableTitle({ value, onCommit }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { setV(value); }, [value]);
  return (
    <input value={v} onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v !== value && onCommit(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
      style={{
        fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500, letterSpacing: "-0.01em",
        border: "1px solid transparent", background: "transparent", color: "var(--ink)",
        padding: "2px 6px", marginInline: -6, borderRadius: 6, width: "min(560px, 50vw)",
      }}
      onFocus={(e) => { e.target.style.background = "var(--paper-sunk)"; e.target.style.borderColor = "var(--hair)"; }}
      onMouseLeave={(e) => { if (document.activeElement !== e.target) { e.target.style.borderColor = "transparent"; } }}
    />
  );
}

function Workspace({ piece, refs, onBack, onGoStudio }) {
  const [tab, setTab] = React.useState("draft");
  const [running, setRunning] = React.useState(false);
  const [gateStatus, setGateStatus] = React.useState({});
  const isMobile = window.useIsMobile();

  const update = (patch) => window.Store.updatePiece(piece.id, patch);

  const runGates = async () => {
    setRunning(true); setTab("draft");
    // First gate is "running", rest "pending"; the rail advances as completed[] grows.
    const init = {}; window.GATES.forEach((g, i) => init[g.id] = i === 0 ? "running" : "pending"); setGateStatus(init);

    // Apply the completed[] list from /review/status onto the per-gate rail: each
    // listed gate is done, and the first not-yet-completed gate shows as running.
    const applyCompleted = (completed) => {
      const set = new Set(completed || []);
      setGateStatus(() => {
        const next = {}; let runningMarked = false;
        window.GATES.forEach((g) => {
          if (set.has(g.id)) { next[g.id] = "done"; }
          else if (!runningMarked) { next[g.id] = "running"; runningMarked = true; }
          else { next[g.id] = "pending"; }
        });
        return next;
      });
    };

    let polling = true;
    const poll = async () => {
      while (polling) {
        await new Promise((r) => setTimeout(r, 900));
        if (!polling) break;
        try {
          const r = await fetch("/api/pieces/" + piece.id + "/review/status", { headers: { Accept: "application/json" } });
          if (!r.ok) continue;
          const st = await r.json();
          applyCompleted(st.completed);
          if (st.done) break;
        } catch (e) { /* transient — keep polling */ }
      }
    };

    try {
      // Persist the latest draft before review so the server reviews current text.
      await fetch("/api/pieces/" + piece.id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ original: piece.original }),
      });

      const pollPromise = poll();
      const r = await fetch("/api/pieces/" + piece.id + "/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      polling = false;
      await pollPromise;
      if (!r.ok) throw new Error("review failed: " + r.status);
      const { packet, status } = await r.json();
      // All gates done; sync the local cache (packet already persisted server-side).
      const finalStatus = {}; window.GATES.forEach((g) => finalStatus[g.id] = (packet && packet[g.id]) ? "done" : "pending"); setGateStatus(finalStatus);
      window.Store.updatePiece(piece.id, { packet, status: status || "Reviewed" });
      setRunning(false);
      if (packet && Object.keys(packet).length) setTab("review");
    } catch (e) {
      polling = false;
      console.error("Review failed:", e);
      setGateStatus((s) => {
        const next = { ...s };
        window.GATES.forEach((g) => { if (next[g.id] === "running") next[g.id] = "error"; });
        return next;
      });
      setRunning(false);
    }
  };

  const refCtx = window.AI.refContext(refs);
  const findingCount = piece.packet ? window.GATES.reduce((n, g) => n + (piece.packet[g.id] ? piece.packet[g.id].findings.length : 0), 0) : null;

  const tabs = [
    { id: "draft", label: "Draft" },
    { id: "review", label: "Review", badge: findingCount },
    { id: "revision", label: "Revision" },
    { id: "outputs", label: "Outputs", badge: (piece.outputOrder || []).length || null },
    { id: "media", label: "Media", badge: window.Store.mediaForPiece(piece.id).length || null },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* piece header */}
      <div style={{ padding: isMobile ? "12px 16px 0" : "18px 32px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <button className="icon-btn" onClick={onBack} title="Back to Library"><Icon name="back" size={16} /></button>
            <EditableTitle value={piece.title} onCommit={(t) => update({ title: t })} />
          </div>
          <StatusPipeline piece={piece} onSet={(s) => window.Store.setStatus(piece.id, s)} />
        </div>
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {/* tab body */}
      {tab === "draft" && (
        <DraftTab piece={piece} running={running} gateStatus={gateStatus}
          onRun={runGates} onChangeOriginal={(t) => update({ original: t })}
          onGoReview={() => setTab("review")} />
      )}
      {tab === "review" && (piece.packet
        ? <ReviewTab piece={piece} />
        : <EmptyState icon="flag" title="No review packet yet" body="Paste a draft on the Draft tab and run the seven gates. The packet appears here, beside your original." />)}
      {tab === "revision" && <RevisionTab piece={piece} onUpdate={update} refCtx={refCtx} />}
      {tab === "outputs" && <OutputsTab piece={piece} onUpdate={update} refCtx={refCtx} onGoStudio={onGoStudio} />}
      {tab === "media" && <MediaTab piece={piece} onGoStudio={onGoStudio} />}
    </div>
  );
}

function MediaTab({ piece, onGoStudio }) {
  const items = window.Store.mediaForPiece(piece.id);
  const pieces = window.Store.getState().pieces.filter((p) => p.campaignId === piece.campaignId);
  const newInStudio = (type) => { window.__studioPrefill = { type, pieceId: piece.id, script: (piece.revision && piece.revision.text) || piece.original || "" }; onGoStudio && onGoStudio(); };
  return (
    <div className="scroll-y" style={{ flex: 1 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 32px 90px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Attached media</div>
            <p className="muted" style={{ fontSize: 15, margin: 0 }}>Imagery, voiceovers, and video generated for this piece.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => newInStudio("image")}><Icon name="image" size={14} /> New image</button>
            <button className="btn primary" onClick={() => newInStudio("avatar")}><Icon name="film" size={14} /> New video</button>
          </div>
        </div>
        <MediaLibrary items={items} pieces={pieces}
          empty={"No media attached yet. Generate some in the Studio — it'll link back here."}
          onAttach={(id, pid) => window.Store.attachMediaToPiece(id, pid)}
          onDelete={(m) => window.Store.removeMedia(m.id)} />
      </div>
    </div>
  );
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "typeface": "Literary",
  "accent": "oklch(0.520 0.118 38)",
  "readingSize": 17.5
}/*EDITMODE-END*/;

const TYPEFACES = {
  Literary: { display: 'Georgia, "Times New Roman", serif', body: 'Georgia, "Times New Roman", serif', note: "Georgia" },
  Newsroom: { display: '"Times New Roman", Times, serif', body: '"Times New Roman", Times, serif', note: "Times" },
  Quiet:    { display: 'ui-serif, Georgia, Cambria, "Times New Roman", serif', body: 'ui-serif, Georgia, Cambria, "Times New Roman", serif', note: "System serif" },
};

function TweaksLayer({ theme }) {
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  React.useEffect(() => {
    const root = document.documentElement;
    const f = TYPEFACES[t.typeface] || TYPEFACES.Literary;
    root.style.setProperty("--font-display", f.display);
    root.style.setProperty("--font-body", f.body);
  }, [t.typeface]);
  React.useEffect(() => {
    const DARK_ACCENT = {
      "oklch(0.520 0.118 38)": "oklch(0.660 0.120 42)",
      "oklch(0.500 0.090 250)": "oklch(0.660 0.090 250)",
      "oklch(0.480 0.080 150)": "oklch(0.660 0.085 150)",
      "oklch(0.480 0.110 330)": "oklch(0.660 0.105 330)",
    };
    const v = (theme === "dark" && DARK_ACCENT[t.accent]) ? DARK_ACCENT[t.accent] : t.accent;
    document.documentElement.style.setProperty("--accent", v);
  }, [t.accent, theme]);
  React.useEffect(() => {
    document.body.style.fontSize = (t.readingSize || 17.5) + "px";
  }, [t.readingSize]);

  return (
    <window.TweaksPanel title="Tweaks">
      <window.TweakSection label="Typeface" />
      <window.TweakRadio label="Pairing" value={t.typeface}
        options={["Literary", "Newsroom", "Quiet"]}
        onChange={(v) => setTweak("typeface", v)} />
      <window.TweakSlider label="Reading size" value={t.readingSize} min={15} max={20} step={0.5} unit="px"
        onChange={(v) => setTweak("readingSize", v)} />
      <window.TweakSection label="Accent" />
      <window.TweakColor label="House color" value={t.accent}
        options={["oklch(0.520 0.118 38)", "oklch(0.500 0.090 250)", "oklch(0.480 0.080 150)", "oklch(0.480 0.110 330)"]}
        onChange={(v) => setTweak("accent", v)} />
    </window.TweaksPanel>
  );
}

function RoleSwitch({ role, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--paper-sunk)", borderRadius: 999, padding: 3 }}>
      {[["author", "Author"], ["assistant", "Assistant"]].map(([id, l]) => (
        <button key={id} onClick={() => onChange(id)} className="mono" title={id === "assistant" ? "Assistant can edit drafts and outputs, but not Preferences" : "Full access"}
          style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "5px 11px", borderRadius: 999, border: "none", cursor: "pointer",
            background: role === id ? "var(--paper-2)" : "transparent", color: role === id ? "var(--ink)" : "var(--ink-3)",
            boxShadow: role === id ? "var(--shadow-sm)" : "none" }}>{l}</button>
      ))}
    </div>
  );
}

function CampaignSwitcher({ campaigns, activeId, onSelect, onAdd }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const active = campaigns.find((c) => c.id === activeId) || campaigns[0];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} title="Switch campaign"
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          border: "1px solid var(--hair-2)", background: "var(--paper-2)", color: "var(--ink)",
          borderRadius: 999, padding: "6px 12px", height: 34 }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--accent)" }} />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 15, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active ? active.name : "No campaign"}</span>
        <Icon name="chevD" size={14} style={{ color: "var(--ink-3)" }} />
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", top: 42, right: 0, width: 248, padding: 6, zIndex: 60, boxShadow: "var(--shadow-lg)", maxHeight: "70vh", overflowY: "auto" }}>
          <div className="eyebrow" style={{ padding: "6px 10px 4px" }}>Campaign · guidelines</div>
          {!campaigns.length && (
            <div className="muted" style={{ padding: "8px 10px", fontSize: 13.5 }}>No campaigns yet.</div>
          )}
          {campaigns.map((c) => {
            const on = c.id === activeId;
            return (
              <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  border: "none", background: on ? "var(--accent-soft)" : "transparent", cursor: "pointer",
                  borderRadius: "var(--radius)", padding: "9px 10px", color: on ? "var(--accent-ink)" : "var(--ink)",
                  fontFamily: "var(--font-body)", fontSize: 15, textAlign: "left" }}
                onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--paper-sunk)"; }}
                onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: on ? "var(--accent)" : "var(--hair-2)" }} />
                  {c.name}
                </span>
                {on && <Icon name="check" size={15} />}
              </button>
            );
          })}
          <hr className="rule" style={{ margin: "5px 4px" }} />
          <button onClick={() => { onAdd(); setOpen(false); }}
            className="mono" style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, border: "none", background: "transparent", cursor: "pointer", borderRadius: "var(--radius)", padding: "9px 10px", color: "var(--ink-3)", fontSize: 12, letterSpacing: "0.04em" }}>
            <Icon name="plus" size={13} /> NEW CAMPAIGN
          </button>
        </div>
      )}
    </div>
  );
}

function CampaignCreateDialog({ open, onClose, onCreate }) {
  const [name, setName] = React.useState("King's Press");
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    setName("King's Press");
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 0);
  }, [open]);
  if (!open) return null;
  const submit = () => {
    const clean = name.trim();
    if (!clean) return;
    onCreate(clean);
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 210, background: "oklch(0 0 0 / 0.32)", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card" style={{ width: "min(520px, 100%)", padding: "26px 28px", boxShadow: "var(--shadow-lg)" }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>New campaign</div>
        <h2 style={{ fontSize: 25, margin: "0 0 10px" }}>Name this body of work</h2>
        <p className="muted" style={{ margin: "0 0 18px", fontSize: 14.5, lineHeight: 1.5 }}>
          Campaigns hold pieces, preferences, Gather sources, and Studio media together.
        </p>
        <input
          ref={inputRef}
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Campaign name"
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}><Icon name="plus" size={14} /> Create campaign</button>
        </div>
      </div>
    </div>
  );
}

function DesktopOnboarding() {
  const [open, setOpen] = React.useState(false);
  const [setupMode, setSetupMode] = React.useState("ollama");
  const [status, setStatus] = React.useState(null);
  const [models, setModels] = React.useState([]);
  const [dockerModels, setDockerModels] = React.useState([]);
  const [model, setModel] = React.useState("llama3.2");
  const [dockerBaseUrl, setDockerBaseUrl] = React.useState("http://localhost:12434/engines/v1");
  const [cloudProvider, setCloudProvider] = React.useState("openai");
  const [cloudBaseUrl, setCloudBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [savedSettings, setSavedSettings] = React.useState(null);
  const [profileName, setProfileName] = React.useState("");
  const [taskDefaults, setTaskDefaults] = React.useState({});

  const desktop = window.KINGS_DESKTOP;
  const setupCompleteKey = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.computeSetupLocalStorageKey) || "kingspress.desktopSetupComplete";
  const modelOptions = ["llama3.2", "mistral", "qwen2.5:7b", "gemma3:4b"];
  const cloudModels = {
    openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
    anthropic: ["claude-haiku-4-5", "claude-sonnet-4-5"],
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
    xai: ["grok-4.3", "grok-3-mini"],
    "openai-compatible": ["local-model"],
  };
  const taskOptions = [
    { id: "gather", label: "Gather" },
    { id: "weave", label: "Weave" },
    { id: "draft", label: "Draft" },
    { id: "review", label: "Review" },
    { id: "revision", label: "Revision" },
    { id: "outputs", label: "Outputs" },
    { id: "utility", label: "Utility" },
    { id: "mediaPrompt", label: "Media prompts" },
    { id: "file", label: "File extraction" },
  ];

  const providerLabel = (provider) => ({
    openai: "OpenAI / ChatGPT",
    anthropic: "Anthropic",
    gemini: "Gemini",
    xai: "xAI / Grok",
    ollama: "Ollama",
    "openai-compatible": "OpenAI-compatible",
  }[provider] || provider || "Provider");

  const profileIdFor = (profile) =>
    String([profile.provider, profile.baseUrl || "", profile.model].join("-"))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "llm-profile";

  const profilesFromSettings = (settings) => {
    if (settings && Array.isArray(settings.profiles) && settings.profiles.length) return settings.profiles;
    if (settings && settings.provider && settings.model) {
      return [{
        id: "default",
        label: "Default",
        provider: settings.provider,
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
      }];
    }
    return [];
  };

  const activeProfileFromSettings = (settings) => {
    const profiles = profilesFromSettings(settings);
    return profiles.find((p) => p.id === settings?.defaultProfileId) || profiles[0] || null;
  };

  const notifyModelSetupSaved = (settings, profile) => {
    if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.notifyProviderSetupSaved) {
      window.KP_ONBOARDING_ACTIONS.notifyProviderSetupSaved({ profile: profile || activeProfileFromSettings(settings) || settings });
    }
  };

  const closeModelSetup = () => {
    if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.notifyProviderSetupClosed) {
      window.KP_ONBOARDING_ACTIONS.notifyProviderSetupClosed({ saved: false });
    }
    setOpen(false);
  };

  React.useEffect(() => {
    if (!desktop || !desktop.isDesktop()) return;
    let active = true;
    let unlisten = null;
    refresh({ syncSetupOpen: true }).catch(() => {
      if (active && window.localStorage.getItem(setupCompleteKey) !== "true") setOpen(true);
    });

    desktop.onShowModelSetup((() => {
      if (!active) return;
      setOpen(true);
      refresh();
    })).then((fn) => {
      unlisten = fn;
      if (!active && typeof unlisten === "function") unlisten();
    }).catch(() => {});

    const openFromDesk = () => {
      if (!active) return;
      setOpen(true);
      refresh();
    };
    window.addEventListener("kingspress:open-model-setup", openFromDesk);

    return () => {
      active = false;
      if (typeof unlisten === "function") unlisten();
      window.removeEventListener("kingspress:open-model-setup", openFromDesk);
    };
  }, []);

  const isDockerModelRunnerSettings = (saved) =>
    !!(saved && saved.provider === "openai-compatible" && saved.baseUrl && saved.baseUrl.includes("12434"));

  const fetchOpenAICompatibleModels = async (baseUrl) => {
    const res = await fetch("/api/llm/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai-compatible", baseUrl }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not list models.");
    return json.models || [];
  };

  const providerBaseUrl = (provider) => ({
    openai: "https://api.openai.com/v1",
    xai: "https://api.x.ai/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    anthropic: "https://api.anthropic.com/v1",
    ollama: "http://127.0.0.1:11434",
  }[provider] || "");

  const currentProviderConfig = () => {
    if (setupMode === "ollama") {
      return { provider: "ollama", model: model.trim(), baseUrl: "http://127.0.0.1:11434" };
    }
    if (setupMode === "docker") {
      return {
        provider: "openai-compatible",
        model: model.trim(),
        baseUrl: dockerBaseUrl.trim() || "http://localhost:12434/engines/v1",
      };
    }
    return {
      provider: cloudProvider,
      model: model.trim(),
      apiKey: apiKey.trim(),
      baseUrl: cloudProvider === "openai-compatible"
        ? cloudBaseUrl.trim()
        : providerBaseUrl(cloudProvider),
    };
  };

  const savedModelChoiceComplete = (saved, ollamaStatus, ollamaModels, savedDockerModels) => {
    const active = activeProfileFromSettings(saved);
    if (!active || !active.provider || !active.model) return false;
    if (active.provider === "ollama") {
      return !!(ollamaStatus && ollamaStatus.installed && ollamaStatus.running && (ollamaModels || []).includes(active.model));
    }
    if (isDockerModelRunnerSettings(active)) {
      return !!(active.baseUrl && (savedDockerModels || []).includes(active.model));
    }
    if (active.provider === "openai-compatible") {
      return !!(active.baseUrl && active.apiKey);
    }
    return !!active.apiKey;
  };

  const refresh = async (options) => {
    if (!desktop || !desktop.isDesktop()) return;
    try {
      await desktop.initLocalDatabase().catch(() => null);
      const [s, list, saved] = await Promise.all([
        desktop.ollamaStatus().catch((e) => ({ installed: false, running: false, message: e.message })),
        desktop.listOllamaModels().catch(() => []),
        desktop.getModelChoice().catch(() => null),
      ]);
      setStatus(s);
      setModels(list || []);
      let savedDockerModels = [];
      const activeSaved = activeProfileFromSettings(saved);
      if (isDockerModelRunnerSettings(activeSaved)) {
        savedDockerModels = await fetchOpenAICompatibleModels(activeSaved.baseUrl).catch(() => []);
        setDockerModels(savedDockerModels);
      }
      const hasSavedModelChoice = savedModelChoiceComplete(saved, s, list || [], savedDockerModels);
      setSavedSettings(saved);
      setTaskDefaults((saved && saved.taskDefaults) || {});
      if (activeSaved && activeSaved.provider) {
        if (activeSaved.provider === "ollama") setSetupMode("ollama");
        else if (isDockerModelRunnerSettings(activeSaved)) setSetupMode("docker");
        else {
          setSetupMode("cloud");
          setCloudProvider(activeSaved.provider);
        }
      }
      if (activeSaved && activeSaved.baseUrl) {
        if (activeSaved.provider === "openai-compatible" && activeSaved.baseUrl.includes("12434")) setDockerBaseUrl(activeSaved.baseUrl);
        else setCloudBaseUrl(activeSaved.baseUrl);
      }
      if (activeSaved && activeSaved.apiKey) setApiKey(activeSaved.apiKey);
      if (activeSaved && activeSaved.model) {
        setModel(activeSaved.model);
        setProfileName(activeSaved.label || providerLabel(activeSaved.provider) + " " + activeSaved.model);
      }
      else if (list && list.length) setModel(list[0]);
      if (options && options.syncSetupOpen) {
        if (hasSavedModelChoice) {
          window.localStorage.setItem(setupCompleteKey, "true");
          setOpen(false);
        } else {
          window.localStorage.removeItem(setupCompleteKey);
          setOpen(true);
        }
      }
      setMessage("");
      return saved;
    } catch (e) {
      setMessage((e && e.message) || "Desktop setup check failed.");
      if (options && options.syncSetupOpen && window.localStorage.getItem(setupCompleteKey) !== "true") setOpen(true);
      return null;
    }
  };

  const withoutEmptyOptionals = (value) => {
    if (Array.isArray(value)) return value.map(withoutEmptyOptionals).filter((item) => item !== undefined);
    if (value && typeof value === "object") {
      const out = {};
      Object.entries(value).forEach(([key, child]) => {
        const cleaned = withoutEmptyOptionals(child);
        if (cleaned !== undefined && cleaned !== "") out[key] = cleaned;
      });
      return out;
    }
    return value === undefined ? undefined : value;
  };

  const pullModel = async () => {
    if (!model.trim()) return;
    setBusy(true); setMessage("Downloading " + model + ". This can take a while.");
    try {
      await desktop.pullOllamaModel(model.trim());
      await refresh();
      setMessage("Model is ready.");
    } catch (e) {
      setMessage((e && e.message) || "Could not download the model.");
    }
    setBusy(false);
  };

  const startOllama = async () => {
    setBusy(true); setMessage("Starting Ollama.");
    try {
      await desktop.startOllama();
      await refresh();
      setMessage("Ollama is running.");
    } catch (e) {
      setMessage((e && e.message) || "Could not start Ollama.");
    }
    setBusy(false);
  };

  const openOllamaDownload = async () => {
    setBusy(true); setMessage("Opening the Ollama installer page.");
    try {
      await desktop.openOllamaDownload();
      setMessage("Install Ollama, then click Check again.");
    } catch (e) {
      setMessage((e && e.message) || "Could not open the Ollama download page.");
    }
    setBusy(false);
  };

  const checkAgain = async () => {
    setBusy(true); setMessage("Checking local model setup.");
    try {
      await refresh();
      setMessage("Setup status updated.");
    } catch (e) {
      setMessage((e && e.message) || "Could not refresh setup status.");
    }
    setBusy(false);
  };

  const listDockerModels = async () => {
    setBusy(true); setMessage("Checking Docker Model Runner.");
    try {
      const listed = await fetchOpenAICompatibleModels(dockerBaseUrl);
      setDockerModels(listed);
      if (listed.length) setModel(listed[0]);
      setProfileName("");
      setMessage(listed.length ? "Docker models loaded." : "Docker Model Runner responded, but no models were listed.");
    } catch (e) {
      setDockerModels([]);
      setMessage((e && e.message) || "Could not reach Docker Model Runner.");
    }
    setBusy(false);
  };

  const listCloudModels = async () => {
    const config = currentProviderConfig();
    setBusy(true); setMessage("Listing models from " + providerLabel(config.provider) + ".");
    try {
      if (config.provider === "openai-compatible" && !config.baseUrl) throw new Error("Add a base URL first.");
      if (config.provider !== "openai-compatible" && config.provider !== "ollama" && !config.apiKey) throw new Error("Add an API key first.");
      const res = await fetch("/api/llm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || "Could not list models.");
      const listed = json && Array.isArray(json.models) ? json.models : [];
      if (listed.length) {
        setModel(listed[0]);
        setMessage("Loaded " + listed.length + " model" + (listed.length === 1 ? "" : "s") + ".");
      } else {
        setMessage("Provider responded, but no models were listed. You can still type a model name and test it.");
      }
    } catch (e) {
      setMessage((e && e.message) || "Could not list models. You can still type a model name and test it.");
    }
    setBusy(false);
  };

  const testModel = async () => {
    const config = currentProviderConfig();
    if (!config.model) {
      setMessage("Choose or type a model before testing.");
      return;
    }
    setBusy(true); setMessage("Testing " + providerLabel(config.provider) + " " + config.model + ".");
    try {
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || "The model test failed.");
      setMessage("Test passed for " + providerLabel(config.provider) + " " + config.model + ".");
    } catch (e) {
      setMessage((e && e.message) || "The model test failed.");
    }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true);
    try {
      const picked = model.trim();
      if (!picked) throw new Error("Choose a model first.");
      let nextProfile = null;
      if (setupMode === "ollama") {
        if (!installed || !running || !models.includes(picked)) throw new Error("Install or start Ollama, then pull the selected model.");
        nextProfile = { provider: "ollama", model: picked, baseUrl: "http://127.0.0.1:11434" };
      } else if (setupMode === "docker") {
        if (!dockerBaseUrl.trim()) throw new Error("Add the Docker Model Runner URL.");
        nextProfile = {
          provider: "openai-compatible",
          model: picked,
          baseUrl: dockerBaseUrl.trim() || "http://localhost:12434/engines/v1",
        };
      } else {
        const key = apiKey.trim();
        if (!key) throw new Error("Add an API key for the selected cloud provider.");
        nextProfile = {
          provider: cloudProvider,
          model: picked,
          baseUrl: cloudProvider === "openai-compatible" ? cloudBaseUrl.trim() : undefined,
          apiKey: key,
        };
      }
      nextProfile.id = profileIdFor(nextProfile);
      nextProfile.label = profileName.trim() || providerLabel(nextProfile.provider) + " " + nextProfile.model;
      const priorProfiles = profilesFromSettings(savedSettings);
      const profiles = priorProfiles.filter((p) => p.id !== nextProfile.id).concat(nextProfile);
      const nextTaskDefaults = Object.fromEntries(taskOptions.map((task) => [task.id, nextProfile.id]));
      const nextSettings = {
        provider: nextProfile.provider,
        model: nextProfile.model,
        baseUrl: nextProfile.baseUrl,
        apiKey: nextProfile.apiKey,
        profiles,
        defaultProfileId: nextProfile.id,
        taskDefaults: nextTaskDefaults,
      };
      const cleanedSettings = withoutEmptyOptionals(nextSettings);
      await desktop.saveLLMSettings(cleanedSettings);
      if (nextProfile.provider === "openai" && nextProfile.apiKey && desktop.saveMediaProviderKey) {
        await desktop.saveMediaProviderKey("openai", nextProfile.apiKey, { baseUrl: "https://api.openai.com/v1" });
      }
      setSavedSettings(cleanedSettings);
      setTaskDefaults(nextTaskDefaults);
      window.localStorage.setItem(setupCompleteKey, "true");
      notifyModelSetupSaved(cleanedSettings, nextProfile);
      setOpen(false);
    } catch (e) {
      setMessage((e && e.message) || (typeof e === "string" ? e : "Could not save the model choice."));
    }
    setBusy(false);
  };

  const saveTaskDefaults = async () => {
    const profiles = profilesFromSettings(savedSettings);
    if (!profiles.length) return;
    setBusy(true);
    try {
      const defaultProfile = activeProfileFromSettings(savedSettings) || profiles[0];
      const nextSettings = {
        ...(savedSettings || {}),
        provider: defaultProfile.provider,
        model: defaultProfile.model,
        baseUrl: defaultProfile.baseUrl,
        apiKey: defaultProfile.apiKey,
        profiles,
        defaultProfileId: (savedSettings && savedSettings.defaultProfileId) || defaultProfile.id,
        taskDefaults,
      };
      const cleanedSettings = withoutEmptyOptionals(nextSettings);
      await desktop.saveLLMSettings(cleanedSettings);
      setSavedSettings(cleanedSettings);
      setMessage("Task defaults saved.");
    } catch (e) {
      setMessage((e && e.message) || (typeof e === "string" ? e : "Could not save task defaults."));
    }
    setBusy(false);
  };

  if (!open) return null;
  const installed = !!(status && status.installed);
  const running = !!(status && status.running);
  const hasModel = models.includes(model);
  const canUseModel = setupMode === "ollama"
    ? installed && running && hasModel && !!model.trim()
    : setupMode === "docker"
      ? !!model.trim() && !!dockerBaseUrl.trim()
      : !!model.trim() && !!apiKey.trim() && (cloudProvider !== "openai-compatible" || !!cloudBaseUrl.trim());
  const savedProfiles = profilesFromSettings(savedSettings);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--paper)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "28px clamp(20px, 4vw, 56px) 22px", borderBottom: "1px solid var(--hair)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexShrink: 0 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>King's Press desktop setup</div>
          <h2 style={{ fontSize: 30, marginBottom: 10 }}>Choose your writing model</h2>
          <p className="muted" style={{ fontSize: 15.5, lineHeight: 1.55, maxWidth: 760 }}>
            King's Press keeps your editorial database local. Use a local model by default, or add a cloud API key when you want hosted compute.
          </p>
        </div>
        <button className="icon-btn" onClick={closeModelSetup} title="Close setup"><Icon name="xLogo" size={15} /></button>
      </div>
      <div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: "28px clamp(20px, 4vw, 56px) 40px" }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <button className={"btn " + (setupMode === "ollama" ? "primary" : "ghost")} onClick={() => { setSetupMode("ollama"); if (models.length) setModel(models[0]); setProfileName(""); }} disabled={busy}>Ollama</button>
          <button className={"btn " + (setupMode === "docker" ? "primary" : "ghost")} onClick={() => { setSetupMode("docker"); setModel(dockerModels.length ? dockerModels[0] : ""); setProfileName(""); }} disabled={busy}>Docker Model Runner</button>
          <button className={"btn " + (setupMode === "cloud" ? "primary" : "ghost")} onClick={() => { setSetupMode("cloud"); setModel((cloudModels[cloudProvider] || [""])[0]); setProfileName(""); }} disabled={busy}>Cloud API key</button>
        </div>
        {setupMode === "ollama" && (
          <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
          <div className="card" style={{ padding: 12, borderRadius: "var(--radius)" }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>OLLAMA</div>
            <div style={{ fontSize: 15 }}>{installed ? (running ? "Installed and running" : "Installed, not running") : "Not detected"}</div>
          </div>
          <div className="card" style={{ padding: 12, borderRadius: "var(--radius)" }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>LOCAL MODELS</div>
            <div style={{ fontSize: 15 }}>{models.length ? models.join(", ") : "None found yet"}</div>
          </div>
        </div>
            {!installed && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <p style={{ margin: 0, fontSize: 14.5 }}>Ollama is not installed yet.</p>
            <button className="btn" disabled={busy} onClick={openOllamaDownload}><Icon name="globe" size={14} /> Install Ollama</button>
            <button className="btn ghost" disabled={busy} onClick={checkAgain}><Icon name="check" size={14} /> Check again</button>
          </div>
            )}
            {installed && !running && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <p style={{ margin: 0, fontSize: 14.5 }}>Ollama is installed but not running.</p>
            <button className="btn" disabled={busy} onClick={startOllama}><Icon name="play" size={14} /> Start Ollama</button>
            <button className="btn ghost" disabled={busy} onClick={checkAgain}><Icon name="check" size={14} /> Check again</button>
          </div>
            )}
            {installed && running && !hasModel && (
          <p style={{ marginTop: 14, fontSize: 14.5 }}>Pull the selected model before finishing setup.</p>
            )}
          </>
        )}
        {setupMode === "docker" && (
          <div style={{ marginTop: 18 }}>
            <label className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Docker Model Runner URL</label>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) auto", gap: 8 }}>
              <input className="field" value={dockerBaseUrl} onChange={(e) => setDockerBaseUrl(e.target.value)} />
              <button className="btn" disabled={busy || !dockerBaseUrl.trim()} onClick={listDockerModels}><Icon name="check" size={14} /> List models</button>
            </div>
            <p className="muted" style={{ marginTop: 8, fontSize: 13.5 }}>Use Docker Desktop's host endpoint, usually http://localhost:12434/engines/v1.</p>
          </div>
        )}
        {setupMode === "cloud" && (
          <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 0.6fr) minmax(220px, 1fr)", gap: 8 }}>
              <select className="field" value={cloudProvider} onChange={(e) => { setCloudProvider(e.target.value); setModel((cloudModels[e.target.value] || [""])[0]); setProfileName(""); }}>
                <option value="openai">OpenAI / ChatGPT</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
                <option value="xai">xAI / Grok</option>
                <option value="openai-compatible">OpenAI-compatible</option>
              </select>
              <input className="field" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" />
            </div>
            {cloudProvider === "openai-compatible" && (
              <input className="field" value={cloudBaseUrl} onChange={(e) => setCloudBaseUrl(e.target.value)} placeholder="https://provider.example/v1" />
            )}
          </div>
        )}
        <label className="eyebrow" style={{ display: "block", marginTop: 18, marginBottom: 6 }}>Model</label>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) auto auto auto", gap: 8 }}>
          <input className="field" value={model} onChange={(e) => setModel(e.target.value)} list="desktop-model-options" placeholder={setupMode === "cloud" ? "model name" : "llama3.2"} />
          <datalist id="desktop-model-options">{(setupMode === "docker" ? dockerModels : setupMode === "cloud" ? (cloudModels[cloudProvider] || []) : modelOptions).map((m) => <option key={m} value={m} />)}</datalist>
          {setupMode === "ollama" && (
            <button className="btn" disabled={busy || !installed || !running || hasModel || !model.trim()} onClick={pullModel}><Icon name="doc" size={14} /> Pull</button>
          )}
          {setupMode === "cloud" && (
            <button className="btn" disabled={busy || (cloudProvider !== "openai-compatible" && !apiKey.trim()) || (cloudProvider === "openai-compatible" && !cloudBaseUrl.trim())} onClick={listCloudModels}><Icon name="check" size={14} /> List models</button>
          )}
          <button className="btn" disabled={busy || !canUseModel} onClick={testModel}><Icon name="play" size={14} /> Test</button>
          <button className="btn primary" disabled={busy || !canUseModel} onClick={finish}>Use model</button>
        </div>
        <label className="eyebrow" style={{ display: "block", marginTop: 14, marginBottom: 6 }}>Profile name</label>
        <input className="field" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder={providerLabel(setupMode === "cloud" ? cloudProvider : setupMode === "docker" ? "openai-compatible" : "ollama") + " " + (model || "model")} />
        {!!savedProfiles.length && (
          <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <div>
                <div className="eyebrow">Task defaults</div>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>Pick which linked profile each workflow uses.</p>
              </div>
              <button className="btn sm" disabled={busy} onClick={saveTaskDefaults}><Icon name="check" size={14} /> Save defaults</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
              {taskOptions.map((task) => (
                <label key={task.id} style={{ display: "grid", gap: 5 }}>
                  <span className="eyebrow">{task.label}</span>
                  <select
                    className="field"
                    value={taskDefaults[task.id] || (savedSettings && savedSettings.defaultProfileId) || savedProfiles[0].id}
                    onChange={(e) => setTaskDefaults({ ...taskDefaults, [task.id]: e.target.value })}
                  >
                    {savedProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {(profile.label || providerLabel(profile.provider)) + " · " + profile.model}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}
          {message && <p style={{ marginTop: 12, color: "var(--accent-ink)", fontSize: 14 }}>{message}</p>}
        </div>
      </div>
    </div>
  );
}

function App() {
  const state = useStore();
  const [view, setView] = React.useState("library");
  const [desktopNotice, setDesktopNotice] = React.useState(null);
  const [backupBusy, setBackupBusy] = React.useState(false);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [lastSetupResult, setLastSetupResult] = React.useState(null);
  const [sentimentOpen, setSentimentOpen] = React.useState(false);
  const [sentimentBusy, setSentimentBusy] = React.useState(false);
  const [campaignCreateOpen, setCampaignCreateOpen] = React.useState(false);
  const isMobile = window.useIsMobile();
  const role = state.role || "author";

  const campaigns = state.campaigns || [];
  const activeCampaign = campaigns.find((c) => c.id === state.activeCampaignId) || campaigns[0];
  const refs = window.Store.activeReferences ? window.Store.activeReferences() : ((activeCampaign && activeCampaign.references) || {});
  const refCtx = window.AI.refContext(refs);
  const campaignPieces = activeCampaign ? state.pieces.filter((p) => p.campaignId === activeCampaign.id) : [];

  const active = state.pieces.find((p) => p.id === state.activePieceId);
  const inWorkspace = view === "workspace" && active;
  const hasDesktopBridge = !!(window.KINGS_DESKTOP && window.KINGS_DESKTOP.isDesktop && window.KINGS_DESKTOP.isDesktop());
  const setupCompletePref = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.onboardingCompletePref) || "setupHelperCompleteV1";
  const firstValuePref = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.firstValuePref) || "onboardingFirstValueEventV1";
  const sentimentPref = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.sentimentPref) || "onboardingSentimentV1";
  const handoffPref = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.handoffPref) || "onboardingAssistantHandoffV1";

  const openPiece = (id) => { window.Store.setActive(id); setView("workspace"); };
  const goLibrary = () => { setView("library"); window.Store.setActive(null); };
  const openModelSetup = () => window.dispatchEvent(new Event("kingspress:open-model-setup"));
  React.useEffect(() => {
    let cancelled = false;
    Promise.resolve(window.Store.ready).then(() => {
      if (cancelled) return;
      const firstValue = window.Store.getPref(firstValuePref, null);
      const onboardingComplete = window.Store.getPref(setupCompletePref, false);
      const shouldOpen = window.KP_CONVERSATIONAL_ONBOARDING && window.KP_CONVERSATIONAL_ONBOARDING.shouldOpenOnboarding
        ? window.KP_CONVERSATIONAL_ONBOARDING.shouldOpenOnboarding({ onboardingComplete, firstValue })
        : (!onboardingComplete && !(firstValue && firstValue.complete));
      if (shouldOpen) setSetupOpen(true);
    });
    return () => { cancelled = true; };
  }, []);
  const completeSetup = (payload) => {
    const result = payload || {};
    const handoff = window.Store.getPref(handoffPref, null);
    window.Store.setPref(setupCompletePref, true);
    setLastSetupResult(Object.assign({}, result, { handoff }));
    if (result.campaignId && window.Store.getCampaign && window.Store.getCampaign(result.campaignId)) {
      window.Store.setActiveCampaign(result.campaignId);
    }
    setSetupOpen(false);
    setView(result.routeTarget || (result.campaignId ? "desk" : "library"));
    if (handoff && handoff.transcriptTurnCount) {
      setDesktopNotice({
        type: "ok",
        text: "Setup saved. Your setup conversation is ready for the desk.",
      });
    }
    if (!window.Store.getPref(sentimentPref, null)) setSentimentOpen(true);
  };
  const submitSentiment = async (rating) => {
    setSentimentBusy(true);
    try {
      if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.submitSentiment) {
        await window.KP_ONBOARDING_ACTIONS.submitSentiment(rating, {
          sessionId: (lastSetupResult && lastSetupResult.sessionId) || "post-setup",
          firstValueComplete: !!(lastSetupResult && lastSetupResult.firstValue && lastSetupResult.firstValue.complete),
          campaignId: lastSetupResult && lastSetupResult.campaignId,
        });
      } else {
        window.Store.setPref(sentimentPref, {
          version: 1,
          rating,
          submittedAt: new Date().toISOString(),
          source: "post_onboarding_prompt",
        });
      }
      setSentimentOpen(false);
    } finally {
      setSentimentBusy(false);
    }
  };
  const dismissSentiment = () => {
    if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.dismissSentiment) {
      window.KP_ONBOARDING_ACTIONS.dismissSentiment({ sessionId: "post-setup" });
    } else {
      window.Store.setPref(sentimentPref, {
        version: 1,
        dismissedAt: new Date().toISOString(),
        source: "post_onboarding_prompt",
      });
    }
    setSentimentOpen(false);
  };
  const createCampaign = (name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    window.Store.addCampaign(clean);
    setCampaignCreateOpen(false);
    setView("library");
  };
  const createDesktopBackup = async () => {
    if (!hasDesktopBridge || backupBusy) return;
    setBackupBusy(true);
    setDesktopNotice(null);
    try {
      const result = await window.KINGS_DESKTOP.createLocalBackup();
      setDesktopNotice({ type: "ok", text: "Backup created" + (result && result.path ? ": " + result.path : ".") });
    } catch (e) {
      setDesktopNotice({ type: "err", text: (e && e.message) || "Could not create backup." });
    }
    setBackupBusy(false);
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" onClick={goLibrary}>
          <span className="mark">King's <span className="em">Press</span></span>
          <span className="sub">Editorial Desk</span>
        </div>
        <nav className="topnav">
          <button className={view === "desk" ? "active" : ""} onClick={() => setView("desk")}>Desk</button>
          <button className={view === "library" ? "active" : ""} onClick={goLibrary}>Library</button>
          <button className={view === "book" ? "active" : ""} onClick={() => setView("book")}>Book</button>
          <button className={view === "gather" ? "active" : ""} onClick={() => setView("gather")}>Gather</button>
          <button className={view === "weave" ? "active" : ""} onClick={() => setView("weave")}>Weave</button>
          <button className={view === "studio" ? "active" : ""} onClick={() => setView("studio")}>Studio</button>
          <button className={view === "references" ? "active" : ""} onClick={() => setView("references")}>Preferences</button>
        </nav>
        <div className="spacer" />
        <CampaignSwitcher campaigns={campaigns} activeId={state.activeCampaignId}
          onSelect={(id) => window.Store.setActiveCampaign(id)} onAdd={() => setCampaignCreateOpen(true)} />
        {!isMobile && <RoleSwitch role={role} onChange={(r) => window.Store.setRole(r)} />}
        <button className="btn sm" onClick={() => setSetupOpen(true)} title="Setup provider, campaign, and preferences">
          <Icon name="gear" size={13} /> Setup
        </button>
        {hasDesktopBridge && (
          <>
            <button className="icon-btn" onClick={createDesktopBackup} title="Create local backup" disabled={backupBusy}>
              {backupBusy ? <Spinner size={15} /> : <Icon name="db" size={16} />}
            </button>
            <button className="icon-btn" onClick={openModelSetup} title="Model settings">
              <Icon name="key" size={16} />
            </button>
          </>
        )}
        <button className="icon-btn" onClick={() => window.Store.toggleTheme()} title="Toggle light / dark">
          <Icon name={state.theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
      </div>

      {!activeCampaign && (
        <EmptyState
          icon="book"
          title="Create your first campaign"
          body="King’s Press starts empty now. Add only the campaigns you actually use, then write pieces, preferences, Gather sources, and Studio assets inside that campaign."
          action={<button className="btn primary" style={{ marginTop: 18 }} onClick={() => setCampaignCreateOpen(true)}><Icon name="plus" size={15} /> New campaign</button>}
        />
      )}

      {activeCampaign && view === "references" && <References refs={refs} role={role} campaignName={activeCampaign && activeCampaign.name} />}
      {activeCampaign && view === "desk" && (
        <Desk campaignId={activeCampaign.id} onOpenPiece={openPiece} />
      )}
      {activeCampaign && view === "weave" && (
        <Weave weave={window.Store.getWeave()} refCtx={refCtx} onOpenPiece={openPiece} />
      )}
      {activeCampaign && view === "gather" && (
        <Gather campaignId={activeCampaign.id} refCtx={refCtx} onGoWeave={() => setView("weave")} />
      )}
      {activeCampaign && view === "studio" && (
        <Studio campaignId={activeCampaign.id} pieces={campaignPieces} onOpenPiece={openPiece} />
      )}
      {activeCampaign && view === "book" && (
        <BookWriter campaigns={campaigns} allPieces={state.pieces} role={role}
          onOpenPiece={openPiece} onActivateCampaign={(id) => window.Store.setActiveCampaign(id)} />
      )}
      {activeCampaign && view === "library" && (
        <Library pieces={campaignPieces} campaignName={activeCampaign && activeCampaign.name} onOpen={openPiece}
          onNew={() => { window.Store.createPiece("Untitled piece"); setView("workspace"); }}
          onDelete={(id) => window.Store.deletePiece(id)} />
      )}
      {activeCampaign && inWorkspace && <Workspace piece={active} refs={refs} onBack={goLibrary} onGoStudio={() => setView("studio")} />}
      {activeCampaign && view === "workspace" && !active && (
        <EmptyState icon="doc" title="No piece open" body="Head back to the Library to open or start one." />
      )}
      {desktopNotice && (
        <div style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 180, maxWidth: "min(520px, calc(100vw - 36px))",
          padding: "10px 13px", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--hair)", background: "var(--paper-2)",
          color: desktopNotice.type === "err" ? "var(--sev-must)" : "var(--ink)",
          fontSize: 13.5, lineHeight: 1.45,
        }}>
          {desktopNotice.text}
          <button className="icon-btn" style={{ width: 24, height: 24, marginLeft: 8, verticalAlign: "middle" }} onClick={() => setDesktopNotice(null)} title="Dismiss">
            <Icon name="xLogo" size={13} />
          </button>
        </div>
      )}
      {sentimentOpen && (
        <div role="dialog" aria-label="Setup usefulness rating" style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 181, width: "min(390px, calc(100vw - 36px))",
          padding: 18, borderRadius: 14, boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--hair)", background: "var(--paper-2)", color: "var(--ink)",
        }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500 }}>
            Was setup useful?
          </h2>
          <p style={{ margin: "8px 0 14px", color: "var(--muted)", lineHeight: 1.45 }}>
            One quick rating helps tune the onboarding without sending anything outside this app.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5].map((rating) => (
              <button
                key={rating}
                className="btn sm"
                disabled={sentimentBusy}
                onClick={() => submitSentiment(rating)}
                aria-label={"Rate setup " + rating + " out of 5"}
              >
                {rating}
              </button>
            ))}
            <button className="btn sm ghost" disabled={sentimentBusy} onClick={dismissSentiment}>
              Not now
            </button>
          </div>
        </div>
      )}
      <TweaksLayer theme={state.theme} />
      {window.SetupHelper && (
        <SetupHelper
          open={setupOpen}
          onClose={() => setSetupOpen(false)}
          onOpenProviderSetup={openModelSetup}
          onComplete={completeSetup}
        />
      )}
      <CampaignCreateDialog open={campaignCreateOpen} onClose={() => setCampaignCreateOpen(false)} onCreate={createCampaign} />
      <DesktopOnboarding />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
