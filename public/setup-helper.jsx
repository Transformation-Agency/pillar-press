/* First-run setup helper. Keeps secrets in the native provider dialog and
   writes campaign preferences through the existing Store/references routes. */

function SetupStep({ n, title, active, done }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 9, padding: "8px 10px",
      borderRadius: 999, border: "1px solid " + (active ? "var(--accent)" : "var(--hair)"),
      background: active ? "var(--accent-soft)" : "transparent",
      color: active ? "var(--accent-ink)" : "var(--ink-3)",
      whiteSpace: "nowrap",
    }}>
      <span className="mono" style={{
        width: 20, height: 20, borderRadius: 999, display: "grid", placeItems: "center",
        background: done ? "var(--accent)" : "var(--paper-2)",
        color: done ? "white" : "inherit", fontSize: 11,
      }}>{done ? <Icon name="check" size={12} /> : n}</span>
      <span className="mono" style={{ fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>{title}</span>
    </div>
  );
}

function SetupField({ label, children, hint }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{hint}</span>}
    </label>
  );
}

function SetupHelper({ open, onClose, onComplete, onOpenProviderSetup, initialStep }) {
  const [step, setStep] = React.useState(initialStep || 0);
  const [providerStatus, setProviderStatus] = React.useState(null);
  const [statusError, setStatusError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [campaignName, setCampaignName] = React.useState("My first campaign");
  const [prefDraft, setPrefDraft] = React.useState(null);
  const state = window.Store.getState();
  const campaigns = state.campaigns || [];
  const activeCampaign = window.Store.activeCampaign && window.Store.activeCampaign();
  const hasCampaign = !!activeCampaign;
  const hasDesktopBridge = !!(window.KINGS_DESKTOP && window.KINGS_DESKTOP.isDesktop && window.KINGS_DESKTOP.isDesktop());

  const loadStatus = async () => {
    setStatusError("");
    try {
      const r = await fetch("/api/llm/status", { headers: { Accept: "application/json" } });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error((data && data.error) || "Provider status is not ready yet.");
      setProviderStatus(data);
    } catch (e) {
      setStatusError((e && e.message) || "Could not read provider status.");
      setProviderStatus(null);
    }
  };

  React.useEffect(() => {
    if (!open) return;
    loadStatus();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const refs = window.Store.activeReferences ? window.Store.activeReferences() : {};
    setPrefDraft({
      selfVision: (refs.selfVision && refs.selfVision.body) || "",
      strategy: (refs.strategy && refs.strategy.body) || "",
      throughlineTag: refs.strategy && refs.strategy.throughlines && refs.strategy.throughlines[0] ? refs.strategy.throughlines[0].tag || "" : "core",
      throughlineName: refs.strategy && refs.strategy.throughlines && refs.strategy.throughlines[0] ? refs.strategy.throughlines[0].name || "" : "",
      throughlineNote: refs.strategy && refs.strategy.throughlines && refs.strategy.throughlines[0] ? refs.strategy.throughlines[0].note || "" : "",
      audienceId: refs.audiences && refs.audiences.list && refs.audiences.list[0] ? refs.audiences.list[0].id || "" : "general",
      audienceName: refs.audiences && refs.audiences.list && refs.audiences.list[0] ? refs.audiences.list[0].name || "" : "",
      audienceNote: refs.audiences && refs.audiences.list && refs.audiences.list[0] ? refs.audiences.list[0].note || "" : "",
      gateSpec: (refs.gateSpec && refs.gateSpec.body) || "",
    });
  }, [open, activeCampaign && activeCampaign.id]);

  if (!open) return null;

  const providerName = providerStatus && providerStatus.provider ? providerStatus.provider : "not configured";
  const modelName = providerStatus && providerStatus.model ? providerStatus.model : "";
  const fileModelName = providerStatus && providerStatus.fileModel ? providerStatus.fileModel : "";
  const capabilityText = (value) => {
    if (!value) return "";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") {
      return Object.entries(value)
        .filter(([, enabled]) => enabled === true)
        .map(([key]) => key)
        .join(", ");
    }
    return String(value);
  };
  const capabilities = capabilityText(providerStatus && providerStatus.capabilities);

  const createCampaign = async () => {
    const name = campaignName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const tempId = window.Store.addCampaign(name);
      if (window.Store.whenCampaignSaved) await window.Store.whenCampaignSaved(tempId);
      setStep(2);
    } catch (e) {
      console.warn("Campaign setup failed:", e);
    }
    setBusy(false);
  };

  const savePreferences = () => {
    if (!prefDraft || !activeCampaign) return;
    const refs = window.Store.activeReferences ? window.Store.activeReferences() : {};
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
      selfVision: Object.assign({}, refs.selfVision || {}, { body: prefDraft.selfVision }),
      gateSpec: Object.assign({}, refs.gateSpec || {}, { body: prefDraft.gateSpec }),
    };
    window.Store.updateReferences(patch);
  };

  const finish = () => {
    if (step === 2) savePreferences();
    if (onComplete) onComplete();
  };

  const skip = () => {
    window.Store.setPref("setupHelperCompleteV1", true);
    if (onClose) onClose();
  };

  const steps = [
    { title: "Model" },
    { title: "Campaign" },
    { title: "Preferences" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 190, background: "oklch(0 0 0 / 0.30)", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card" style={{ width: "min(880px, 100%)", maxHeight: "calc(100vh - 40px)", overflow: "auto", padding: 0, boxShadow: "var(--shadow-lg)" }}>
        <div style={{ padding: "22px 26px 18px", borderBottom: "1px solid var(--hair)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Skippable setup</div>
            <h2 style={{ fontSize: 30, margin: 0 }}>Make the desk yours</h2>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 15.5, lineHeight: 1.55 }}>
              Connect a model, start a campaign, and add the preferences every draft, review, Gather run, and Studio prompt should respect.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose || skip} title="Close"><Icon name="xLogo" size={15} /></button>
        </div>

        <div style={{ padding: "14px 26px", borderBottom: "1px solid var(--hair)", display: "flex", gap: 8, overflowX: "auto" }}>
          {steps.map((s, i) => <SetupStep key={s.title} n={i + 1} title={s.title} active={step === i} done={i < step || (i === 1 && hasCampaign)} />)}
        </div>

        <div style={{ padding: "24px 26px 26px" }}>
          {step === 0 && (
            <div style={{ display: "grid", gap: 16 }}>
              <div className="card" style={{ padding: 16, background: "var(--paper-sunk)" }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Current provider</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  <div><div className="muted" style={{ fontSize: 12 }}>Text</div><strong>{providerName}{modelName ? " / " + modelName : ""}</strong></div>
                  <div><div className="muted" style={{ fontSize: 12 }}>File fallback</div><strong>{fileModelName || "not configured"}</strong></div>
                  <div><div className="muted" style={{ fontSize: 12 }}>Capabilities</div><strong>{capabilities || "unknown"}</strong></div>
                </div>
                {statusError && <div style={{ marginTop: 10, color: "var(--sev-must)", fontSize: 13.5 }}>{statusError}</div>}
              </div>
              <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, margin: 0 }}>
                King's Press is local-first. Use Ollama or Docker Model Runner for local work, then add optional cloud profiles like OpenAI, Anthropic, Gemini, xAI/Grok, or any OpenAI-compatible endpoint when a task needs them.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary" onClick={onOpenProviderSetup} disabled={!hasDesktopBridge}>
                  <Icon name="key" size={14} /> Open provider setup
                </button>
                <button className="btn ghost" onClick={loadStatus}><Icon name="check" size={14} /> Refresh status</button>
                {!hasDesktopBridge && <span className="muted" style={{ fontSize: 13.5, alignSelf: "center" }}>Provider setup is available in the installed desktop app.</span>}
              </div>
            </div>
          )}

          {step === 1 && (
            <div style={{ display: "grid", gap: 16 }}>
              {hasCampaign ? (
                <div className="card" style={{ padding: 16, background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
                  <div className="eyebrow" style={{ color: "inherit", marginBottom: 4 }}>Active campaign</div>
                  <strong>{activeCampaign.name}</strong>
                  <p style={{ margin: "8px 0 0", fontSize: 14.5 }}>This is where pieces, Gather sources, media, and preferences will live.</p>
                </div>
              ) : (
                <>
                  <SetupField label="Campaign name" hint="A campaign is the folder for one body of work: preferences, pieces, sources, and media.">
                    <input className="field" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createCampaign(); }} />
                  </SetupField>
                  <button className="btn primary" onClick={createCampaign} disabled={busy || !campaignName.trim()} style={{ justifySelf: "start" }}>
                    {busy ? <><Spinner size={14} /> Starting...</> : <><Icon name="plus" size={14} /> Start campaign</>}
                  </button>
                </>
              )}
              {!!campaigns.length && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Existing campaigns</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {campaigns.map((c) => (
                      <button key={c.id} className={"btn sm " + (activeCampaign && activeCampaign.id === c.id ? "primary" : "ghost")} onClick={() => window.Store.setActiveCampaign(c.id)}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && prefDraft && (
            <div style={{ display: "grid", gap: 16 }}>
              {!hasCampaign && <div style={{ color: "var(--sev-must)", fontSize: 14 }}>Start or select a campaign before saving preferences.</div>}
              <SetupField label="Self statement" hint="The first-person public identity and voice anchor. This maps to Self-Vision in the prompt context.">
                <textarea className="field" value={prefDraft.selfVision} onChange={(e) => setPrefDraft({ ...prefDraft, selfVision: e.target.value })} rows={5} placeholder="Who are you, what do you stand for, and how should the desk sound when writing with you?" />
              </SetupField>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                <SetupField label="Primary throughline">
                  <input className="field" value={prefDraft.throughlineName} onChange={(e) => setPrefDraft({ ...prefDraft, throughlineName: e.target.value })} placeholder="e.g. Local-first creative systems" />
                </SetupField>
                <SetupField label="Throughline tag">
                  <input className="field mono" value={prefDraft.throughlineTag} onChange={(e) => setPrefDraft({ ...prefDraft, throughlineTag: e.target.value })} placeholder="core" />
                </SetupField>
              </div>
              <SetupField label="Throughline note">
                <textarea className="field" value={prefDraft.throughlineNote} onChange={(e) => setPrefDraft({ ...prefDraft, throughlineNote: e.target.value })} rows={3} />
              </SetupField>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                <SetupField label="Primary audience">
                  <input className="field" value={prefDraft.audienceName} onChange={(e) => setPrefDraft({ ...prefDraft, audienceName: e.target.value })} placeholder="e.g. Independent operators" />
                </SetupField>
                <SetupField label="Audience id">
                  <input className="field mono" value={prefDraft.audienceId} onChange={(e) => setPrefDraft({ ...prefDraft, audienceId: e.target.value })} placeholder="general" />
                </SetupField>
              </div>
              <SetupField label="Audience note">
                <textarea className="field" value={prefDraft.audienceNote} onChange={(e) => setPrefDraft({ ...prefDraft, audienceNote: e.target.value })} rows={3} />
              </SetupField>
              <SetupField label="Gate preferences" hint="Extra instructions for how strict the seven editorial gates should be. The canonical gate prompts still run.">
                <textarea className="field" value={prefDraft.gateSpec} onChange={(e) => setPrefDraft({ ...prefDraft, gateSpec: e.target.value })} rows={4} placeholder="e.g. Be strict on unsupported claims, gentle on voice, and flag anything that sounds generic." />
              </SetupField>
            </div>
          )}
        </div>

        <div style={{ padding: "14px 26px", borderTop: "1px solid var(--hair)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <button className="btn ghost" onClick={skip}>Skip for now</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>Back</button>
            {step < 2 ? (
              <button className="btn primary" onClick={() => setStep(Math.min(2, step + 1))} disabled={step === 1 && !hasCampaign}>Next <Icon name="arrowR" size={14} /></button>
            ) : (
              <button className="btn primary" onClick={finish} disabled={!hasCampaign}><Icon name="check" size={14} /> Finish setup</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SetupHelper });
