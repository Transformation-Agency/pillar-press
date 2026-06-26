/* Gather — research ingestion: connect sources, run live connectors (each writes
   its own research brief), curate results, and pipe them into Weave. */

function GToggle({ on, onChange }) {
  return (
    <button onClick={onChange} title={on ? "Enabled" : "Disabled"} style={{ width: 36, height: 21, borderRadius: 999, border: "none", cursor: "pointer", padding: 2, background: on ? "var(--accent)" : "var(--hair-2)", flexShrink: 0 }}>
      <span style={{ display: "block", width: 17, height: 17, borderRadius: 999, background: "var(--paper-2)", transform: on ? "translateX(15px)" : "translateX(0)", transition: "transform 0.2s", boxShadow: "var(--shadow-sm)" }} />
    </button>
  );
}

function SourceRow({ source }) {
  const k = window.GATHER.SOURCE_KINDS[source.kind] || { label: source.kind, icon: "doc", placeholder: "" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid var(--hair)", borderRadius: "var(--radius)", background: "var(--paper-2)", opacity: source.enabled ? 1 : 0.6 }}>
      <span style={{ width: 30, height: 30, borderRadius: 7, display: "grid", placeItems: "center", background: "var(--paper-sunk)", color: "var(--accent-ink)", flexShrink: 0 }}><Icon name={k.icon} size={16} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>{k.label}{source.lastCount != null ? ` · ${source.lastCount} found` : ""}</div>
        <input className="field" value={source.config || ""} placeholder={k.placeholder}
          onChange={(e) => window.Store.updateGatherSource(source.id, { config: e.target.value, lastError: null })}
          style={{ background: "transparent", border: "1px solid transparent", padding: "3px 0", fontSize: 14.5, marginTop: 1 }} />
        {source.lastError && <div style={{ fontSize: 12, color: "var(--sev-must)", marginTop: 3 }}>{source.lastError}</div>}
      </div>
      <GToggle on={source.enabled} onChange={() => window.Store.updateGatherSource(source.id, { enabled: !source.enabled })} />
      <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => window.Store.removeGatherSource(source.id)} title="Remove"><Icon name="trash" size={13} /></button>
    </div>
  );
}

function GatherItem({ item, onToggle }) {
  const k = window.GATHER.SOURCE_KINDS[item.kind] || { label: item.kind, icon: "doc" };
  return (
    <div onClick={() => onToggle(item)} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--hair)", cursor: "pointer", background: item.selected ? "var(--accent-soft)" : "transparent", transition: "background 0.15s" }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, border: "1.5px solid " + (item.selected ? "var(--accent)" : "var(--hair-2)"), background: item.selected ? "var(--accent)" : "transparent", display: "grid", placeItems: "center", marginTop: 3 }}>
        {item.selected && <Icon name="check" size={12} style={{ color: "oklch(0.99 0.01 80)" }} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
          <span className="chip" style={{ gap: 5 }}><Icon name={k.icon} size={11} /> {k.label}</span>
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{item.source}{item.author ? " · " + item.author : ""}{item.date ? " · " + item.date : ""}</span>
          {item.demo && <span className="mono" style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "var(--paper-sunk)", color: "var(--ink-3)", letterSpacing: "0.06em" }}>DEMO</span>}
          {item.url && /^https?:/i.test(item.url) && <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="mono" style={{ fontSize: 10, color: "var(--accent-ink)" }}>open ↗</a>}
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 17, lineHeight: 1.25, marginBottom: 3 }}>{item.title}</div>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{item.transcript ? <span>{item.kind !== "upload" && <span className="eyebrow">Transcript · </span>}{item.transcript.slice(0, 300)}{item.transcript.length > 300 ? "…" : ""}</span> : item.snippet}</div>
      </div>
    </div>
  );
}

function SummaryCard({ summary, onSendToWeave, onDismiss }) {
  const k = window.GATHER.SOURCE_KINDS[summary.kind] || { label: summary.kind, icon: "doc" };
  const [open, setOpen] = React.useState(true);
  const title = summary.label || (summary.query ? `${k.label}: ${summary.query}` : k.label);
  return (
    <div className="card" style={{ padding: "16px 18px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="chip" style={{ gap: 5 }}><Icon name={k.icon} size={11} /> {k.label}</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 16, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: "auto" }}>{summary.itemCount} source{summary.itemCount === 1 ? "" : "s"}</span>
        <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setOpen((o) => !o)} title={open ? "Collapse" : "Expand"}><Icon name={open ? "chevD" : "chevR"} size={14} /></button>
      </div>
      {open && (
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.6, color: "var(--ink-2)", maxHeight: 340, overflowY: "auto", padding: "2px 2px 6px" }}>{summary.text}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn sm" onClick={() => onSendToWeave(summary)}><Icon name="arrowR" size={13} /> Send to Weave</button>
        <CopyButton text={summary.text} label="Copy" />
        <button className="btn ghost sm" onClick={() => onDismiss(summary.id)} title="Dismiss this brief"><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );
}

function SchedulePanel({ campaignId }) {
  const [version, setVersion] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [schedErr, setSchedErr] = React.useState(null);
  const [cadence, setCadence] = React.useState("daily");
  const [time, setTime] = React.useState("08:00");
  const [dayOfWeek, setDayOfWeek] = React.useState(String(new Date().getDay()));
  const [runAt, setRunAt] = React.useState("");
  const schedules = window.GATHER.listSchedules(campaignId);

  React.useEffect(() => {
    let cancelled = false;
    const sync = (showSpinner) => {
      if (showSpinner) setSyncing(true);
      window.GATHER.syncSchedules(campaignId)
        .then(() => { if (!cancelled) setVersion((v) => v + 1); })
        .finally(() => { if (!cancelled && showSpinner) setSyncing(false); });
    };
    sync(true);
    // The desktop scheduler stamps runs into SQLite in the background; re-sync
    // periodically so "last run" doesn't go stale while the panel stays open.
    const timer = setInterval(() => sync(false), 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [campaignId]);

  const save = async () => {
    setSchedErr(null); setSaving(true);
    const base = { campaignId, cadence, time, timeOfDay: time, dayOfWeek: Number(dayOfWeek) };
    try {
      await window.GATHER.saveSchedule(cadence === "once" ? { campaignId, cadence, runAt } : base);
      setVersion((v) => v + 1);
    } catch (e) { setSchedErr((e && e.message) || "Could not save the schedule."); }
    setSaving(false);
  };
  const remove = async (id) => {
    setSchedErr(null);
    try {
      await window.GATHER.deleteSchedule(id);
      setVersion((v) => v + 1);
    } catch (e) { setSchedErr((e && e.message) || "Could not delete the schedule."); }
  };
  const label = (s) => {
    if (s.cadence === "once") return "Once · " + (s.runAt ? new Date(s.runAt).toLocaleString() : "not set");
    if (s.cadence === "weekly") return "Weekly · " + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.dayOfWeek || 0] + " " + s.time;
    return "Daily · " + s.time;
  };

  return (
    <div className="card" style={{ padding: "16px 18px", marginTop: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Schedule{syncing ? " · syncing" : ""}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select className="field" value={cadence} onChange={(e) => setCadence(e.target.value)} style={{ fontSize: 14, padding: "8px 10px" }}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="once">Once</option>
        </select>
        {cadence === "once" ? (
          <input className="field" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} style={{ fontSize: 14, padding: "8px 10px" }} />
        ) : (
          <input className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ fontSize: 14, padding: "8px 10px" }} />
        )}
        {cadence === "weekly" && (
          <select className="field" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} style={{ fontSize: 14, padding: "8px 10px" }}>
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        )}
        <button className="btn sm" onClick={save} disabled={saving || (cadence === "once" && !runAt)}>{saving ? <Spinner size={13} /> : <Icon name="gear" size={13} />} Save schedule</button>
      </div>
      {schedErr && <p style={{ color: "var(--sev-must)", fontSize: 13, marginTop: 8, marginBottom: 0 }}>{schedErr}</p>}
      {schedules.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
          {schedules.map((s) => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", fontSize: 13.5, padding: "8px 10px", border: "1px solid var(--hair)", borderRadius: "var(--radius)" }}>
              <span>{label(s)}{s.lastRunAt ? <span className="muted"> · last run {new Date(s.lastRunAt).toLocaleString()}</span> : ""}</span>
              <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => remove(s.id)} title="Remove schedule"><Icon name="trash" size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Schedules run while Pillar Press is open. In the desktop app, the local scheduler runs in the background.</p>
    </div>
  );
}

/* Connector keys. Saved encrypted into the native desktop settings file via the
   Tauri bridge (never through a server route); env vars remain a dev fallback. */
const GATHER_INTEGRATIONS = [
  { id: "brave", name: "Brave Search", powers: "Web search", hint: "Get a free key at brave.com/search/api" },
  { id: "x", name: "X API", powers: "X posts", hint: "App bearer token — needs a paid X API tier" },
  { id: "youtube", name: "YouTube Data API", powers: "video titles & channels", optional: true, hint: "Optional — transcripts work without it" },
  { id: "ncbi", name: "NCBI", powers: "PubMed lookups", optional: true, hint: "Optional — raises PubMed rate limits" },
];

function IntegrationRow({ def, configured, onSaved }) {
  const [open, setOpen] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const desktop = window.PILLAR_DESKTOP;
  const canSave = !!(desktop && desktop.isDesktop && desktop.isDesktop() && desktop.saveIntegrationKey);

  const save = async (value) => {
    setBusy(true); setMsg(null);
    try {
      if (!canSave) throw new Error("Keys save from the desktop app only. For browser dev, set the env var instead.");
      await desktop.saveIntegrationKey(def.id, value);
      setApiKey(""); setOpen(false);
      setMsg(value ? "Saved encrypted." : "Disconnected.");
      if (onSaved) await onSaved();
    } catch (e) { setMsg((e && e.message) || "Could not save the key."); }
    setBusy(false);
  };

  return (
    <div style={{ padding: "9px 0", borderBottom: "1px solid var(--hair)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 14 }}>{def.name}</span>
          <span className="mono" style={{ fontSize: 10, marginLeft: 7, color: configured ? "var(--st-approved)" : "var(--ink-3)" }}>
            {configured == null ? "…" : configured ? "Connected" : def.optional ? "Optional" : "Not connected"}
          </span>
          <div className="muted" style={{ fontSize: 12 }}>Powers {def.powers}. {def.hint}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn ghost sm" disabled={busy} onClick={() => { setOpen(!open); setMsg(null); }} title={configured ? "Replace the saved key" : "Connect " + def.name}>
            <Icon name="key" size={12} /> {configured ? "Update" : "Connect"}
          </button>
          {configured && (
            <button className="icon-btn" style={{ width: 26, height: 26 }} disabled={busy} onClick={() => save("")} title={"Disconnect " + def.name}>
              <Icon name="trash" size={12} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input className="field" type="password" value={apiKey} placeholder={def.name + " API key"}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) save(apiKey.trim()); }}
            style={{ flex: 1, fontSize: 13, padding: "7px 9px" }} />
          <button className="btn primary sm" disabled={busy || !apiKey.trim()} onClick={() => save(apiKey.trim())}>
            {busy ? <Spinner size={12} /> : <Icon name="check" size={12} />} Save
          </button>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, marginTop: 6, color: /saved|disconnected/i.test(msg) ? "var(--st-approved)" : "var(--sev-must)" }}>{msg}</div>}
    </div>
  );
}

function IntegrationsPanel() {
  const [status, setStatus] = React.useState(null);
  const refresh = React.useCallback(() => {
    return fetch("/api/gather/integrations", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setStatus((s && s.integrations) || {}))
      .catch(() => setStatus({}));
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="card" style={{ padding: "16px 18px", marginTop: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>Integrations</div>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 6px" }}>Keys are saved encrypted on this Mac and never leave the local server.</p>
      {GATHER_INTEGRATIONS.map((def) => (
        <IntegrationRow key={def.id} def={def}
          configured={status == null ? null : !!(status[def.id] && status[def.id].configured)}
          onSaved={refresh} />
      ))}
    </div>
  );
}

function Gather({ campaignId, refCtx, onGoWeave }) {
  const isMobile = window.useIsMobile();
  const sources = window.Store.getGatherSources(campaignId);
  const items = window.Store.getGatherItems(campaignId);
  const [running, setRunning] = React.useState(false);
  const [prog, setProg] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [filter, setFilter] = React.useState("all");
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef(null);

  React.useEffect(() => {
    window.GATHER.startScheduler && window.GATHER.startScheduler();
  }, []);

  const summaries = window.Store.getGatherSummaries(campaignId);
  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);
  const selected = items.filter((i) => i.selected);
  const usedKinds = [...new Set(items.map((i) => i.kind))];

  const sendSummaryToWeave = (s) => {
    window.GATHER.sendGatherSummaryToWeave(s);
    onGoWeave && onGoWeave();
  };
  const sendAllSummariesToWeave = () => {
    window.GATHER.sendGatherSummariesToWeave(summaries);
    onGoWeave && onGoWeave();
  };

  const run = async () => {
    setRunning(true); setErr(null); setProg(null);
    try { await window.GATHER.runGather(sources, refCtx, (p) => setProg(p)); }
    catch (e) { setErr(e.message || "Gather failed."); }
    setRunning(false); setProg(null);
  };

  const uploadDocs = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    setUploading(true); setErr(null);
    for (const f of files) {
      try {
        const text = await window.extractFileText(f);
        window.Store.addUploadedItem({
          title: f.name.replace(/\.[^.]+$/, ""),
          source: "Uploaded · " + f.name,
          snippet: text.slice(0, 400),
          transcript: text,
        });
      } catch (err) { setErr((err && err.message) || ("Couldn't read " + f.name + ".")); }
    }
    setUploading(false);
  };

  const sendToWeave = () => {
    window.GATHER.sendGatherItemsToWeave(selected);
    onGoWeave && onGoWeave();
  };

  const progLabel = prog && !prog.done ? `Gathering from ${prog.label} — ${prog.i + 1} of ${prog.total}…` : "";

  return (
    <div className="scroll-y" style={{ flex: 1 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 90px" }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Research</div>
        <h1 style={{ fontSize: 42, letterSpacing: "-0.02em" }}>Gather</h1>
        <p className="muted" style={{ fontSize: 16, marginTop: 12, maxWidth: "62ch" }}>
          Connect news feeds, web &amp; database searches, verified journal libraries, X posts, and YouTube transcripts. Run a gather, curate the results, and send the keepers straight into Weave.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", borderRadius: "var(--radius)", background: "var(--paper-sunk)", marginTop: 16, fontSize: 13, color: "var(--ink-2)", maxWidth: "74ch" }}>
          <Icon name="sparkle" size={15} style={{ color: "var(--accent-ink)", flexShrink: 0 }} />
          <span>Each enabled source fetches live results, then writes its own research brief. Send any brief — or individual results — to Weave. <strong>RSS, journals, scrape &amp; YouTube</strong> need no key; <strong>web search</strong> and <strong>X posts</strong> need a key — connect them under <strong>Integrations</strong> below.</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "400px 1fr", gap: isMobile ? 18 : 32, alignItems: "start", marginTop: isMobile ? 18 : 28 }}>
          {/* sources */}
          <div className="card" style={{ padding: "20px 22px", position: isMobile ? "static" : "sticky", top: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Sources</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {window.GATHER.kindList().map((k) => (
                <button key={k.id} className="btn ghost sm" onClick={() => window.Store.addGatherSource({ kind: k.id, config: "" })} title={k.hint}>
                  <Icon name={k.icon} size={13} /> {k.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sources.length === 0 && <div style={{ padding: "30px 18px", textAlign: "center", border: "1px dashed var(--hair-2)", borderRadius: "var(--radius)" }}><p className="muted" style={{ fontStyle: "italic", margin: 0, fontSize: 14 }}>Add a source above to begin.</p></div>}
              {sources.map((s) => <SourceRow key={s.id} source={s} />)}
            </div>
            <button className="btn primary" style={{ width: "100%", marginTop: 16 }} disabled={running || !sources.some((s) => s.enabled && (s.config || "").trim())} onClick={run}>
              {running ? <><Spinner size={15} /> Gathering…</> : <><Icon name="globe" size={15} /> Gather now</>}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 2px" }}>
              <div style={{ flex: 1, height: 1, background: "var(--hair)" }} />
              <span className="eyebrow" style={{ fontSize: 10 }}>or</span>
              <div style={{ flex: 1, height: 1, background: "var(--hair)" }} />
            </div>
            <input ref={fileRef} type="file" accept={window.UPLOAD_ACCEPT} multiple style={{ display: "none" }} onChange={uploadDocs} />
            <button className="btn ghost" style={{ width: "100%" }} disabled={uploading} onClick={() => fileRef.current.click()} title="Upload PDFs, images, .docx, or text files as research items">
              {uploading ? <><Spinner size={14} /> Reading…</> : <><Icon name="doc" size={14} /> Upload documents</>}
            </button>
            <SchedulePanel campaignId={campaignId} />
            <IntegrationsPanel />
            {progLabel && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, color: "var(--accent-ink)" }}><Spinner size={14} /> {progLabel}</div>}
            {err && <p style={{ color: "var(--sev-must)", fontSize: 13.5, marginTop: 12 }}>{err}</p>}
          </div>

          {/* results */}
          <div>
            {/* per-source research briefs */}
            {summaries.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <div className="eyebrow" style={{ marginRight: "auto" }}><Icon name="sparkle" size={12} style={{ marginRight: 5 }} />{summaries.length} research brief{summaries.length === 1 ? "" : "s"}</div>
                  <button className="btn sm" onClick={sendAllSummariesToWeave}><Icon name="arrowR" size={13} /> Send all to Weave</button>
                </div>
                {summaries.map((s) => (
                  <SummaryCard key={s.id} summary={s} onSendToWeave={sendSummaryToWeave} onDismiss={(id) => window.Store.removeGatherSummary(id)} />
                ))}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              <div className="eyebrow" style={{ marginRight: "auto" }}>{items.length} gathered{selected.length ? ` · ${selected.length} selected` : ""}</div>
              {items.length > 0 && <>
                <button className="btn ghost sm" onClick={() => { const target = !shown.every((s) => s.selected); shown.forEach((i) => window.Store.updateGatherItem(i.id, { selected: target })); }}>Select all</button>
                <button className="btn sm" disabled={!selected.length} onClick={sendToWeave}><Icon name="arrowR" size={13} /> Send {selected.length || ""} to Weave</button>
                <button className="btn ghost sm" onClick={() => window.Store.clearGatherItems(campaignId)} title="Clear results"><Icon name="trash" size={13} /></button>
              </>}
            </div>
            {usedKinds.length > 1 && (
              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {["all", ...usedKinds].map((kf) => {
                  const on = kf === filter;
                  const lbl = kf === "all" ? "All" : (window.GATHER.SOURCE_KINDS[kf] || { label: kf }).label;
                  return <button key={kf} onClick={() => setFilter(kf)} className="mono" style={{ fontSize: 11, padding: "5px 10px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? "var(--ink)" : "var(--hair)"), background: on ? "var(--ink)" : "transparent", color: on ? "var(--paper)" : "var(--ink-2)" }}>{lbl}</button>;
                })}
              </div>
            )}
            {items.length === 0 ? (
              <div style={{ padding: "60px 24px", textAlign: "center", border: "1px dashed var(--hair-2)", borderRadius: "var(--radius-lg)" }}>
                <p className="muted" style={{ fontStyle: "italic", margin: 0 }}>No results yet. Configure sources and hit Gather.</p>
              </div>
            ) : (
              <div className="card" style={{ overflow: "hidden" }}>
                {shown.map((it) => <GatherItem key={it.id} item={it} onToggle={(i) => window.Store.updateGatherItem(i.id, { selected: !i.selected })} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Gather });
