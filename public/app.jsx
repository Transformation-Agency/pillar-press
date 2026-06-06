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
  Literary: { display: '"Newsreader", Georgia, serif', body: '"Spectral", Georgia, serif', note: "Newsreader + Spectral" },
  Newsroom: { display: '"Source Serif 4", Georgia, serif', body: '"Source Serif 4", Georgia, serif', note: "Source Serif" },
  Quiet:    { display: '"Spectral", Georgia, serif', body: '"Spectral", Georgia, serif', note: "Spectral throughout" },
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
        <button key={id} onClick={() => onChange(id)} className="mono" title={id === "assistant" ? "Assistant can edit drafts & outputs, but not References" : "Full access"}
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
        <span style={{ fontFamily: "var(--font-display)", fontSize: 15, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active && active.name}</span>
        <Icon name="chevD" size={14} style={{ color: "var(--ink-3)" }} />
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", top: 42, right: 0, width: 248, padding: 6, zIndex: 60, boxShadow: "var(--shadow-lg)", maxHeight: "70vh", overflowY: "auto" }}>
          <div className="eyebrow" style={{ padding: "6px 10px 4px" }}>Campaign · guidelines</div>
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
          <button onClick={() => { const n = prompt("New campaign name"); if (n && n.trim()) onAdd(n.trim()); setOpen(false); }}
            className="mono" style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, border: "none", background: "transparent", cursor: "pointer", borderRadius: "var(--radius)", padding: "9px 10px", color: "var(--ink-3)", fontSize: 12, letterSpacing: "0.04em" }}>
            <Icon name="plus" size={13} /> NEW CAMPAIGN
          </button>
        </div>
      )}
    </div>
  );
}

function App() {
  const state = useStore();
  const [view, setView] = React.useState("library");
  const isMobile = window.useIsMobile();
  const role = state.role || "author";

  const campaigns = state.campaigns || [];
  const activeCampaign = campaigns.find((c) => c.id === state.activeCampaignId) || campaigns[0];
  const refs = (activeCampaign && activeCampaign.references) || {};
  const refCtx = window.AI.refContext(refs);
  const campaignPieces = state.pieces.filter((p) => p.campaignId === state.activeCampaignId);

  const active = state.pieces.find((p) => p.id === state.activePieceId);
  const inWorkspace = view === "workspace" && active;

  const openPiece = (id) => { window.Store.setActive(id); setView("workspace"); };
  const goLibrary = () => { setView("library"); window.Store.setActive(null); };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" onClick={goLibrary}>
          <span className="mark">Pillar <span className="em">Press</span></span>
          <span className="sub">Editorial Desk</span>
        </div>
        <nav className="topnav">
          <button className={view === "library" ? "active" : ""} onClick={goLibrary}>Library</button>
          <button className={view === "book" ? "active" : ""} onClick={() => setView("book")}>Book</button>
          <button className={view === "gather" ? "active" : ""} onClick={() => setView("gather")}>Gather</button>
          <button className={view === "weave" ? "active" : ""} onClick={() => setView("weave")}>Weave</button>
          <button className={view === "studio" ? "active" : ""} onClick={() => setView("studio")}>Studio</button>
          <button className={view === "references" ? "active" : ""} onClick={() => setView("references")}>References</button>
        </nav>
        <div className="spacer" />
        <CampaignSwitcher campaigns={campaigns} activeId={state.activeCampaignId}
          onSelect={(id) => window.Store.setActiveCampaign(id)} onAdd={(n) => window.Store.addCampaign(n)} />
        {!isMobile && <RoleSwitch role={role} onChange={(r) => window.Store.setRole(r)} />}
        <button className="icon-btn" onClick={() => window.Store.toggleTheme()} title="Toggle light / dark">
          <Icon name={state.theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
      </div>

      {view === "references" && <References refs={refs} role={role} campaignName={activeCampaign && activeCampaign.name} />}
      {view === "weave" && (
        <Weave weave={window.Store.getWeave()} refCtx={refCtx} onOpenPiece={openPiece} />
      )}
      {view === "gather" && (
        <Gather campaignId={state.activeCampaignId} refCtx={refCtx} onGoWeave={() => setView("weave")} />
      )}
      {view === "studio" && (
        <Studio campaignId={state.activeCampaignId} pieces={campaignPieces} onOpenPiece={openPiece} />
      )}
      {view === "book" && (
        <BookWriter campaigns={campaigns} allPieces={state.pieces} role={role}
          onOpenPiece={openPiece} onActivateCampaign={(id) => window.Store.setActiveCampaign(id)} />
      )}
      {view === "library" && (
        <Library pieces={campaignPieces} campaignName={activeCampaign && activeCampaign.name} onOpen={openPiece}
          onNew={() => { window.Store.createPiece("Untitled piece"); setView("workspace"); }}
          onDelete={(id) => window.Store.deletePiece(id)} />
      )}
      {inWorkspace && <Workspace piece={active} refs={refs} onBack={goLibrary} onGoStudio={() => setView("studio")} />}
      {view === "workspace" && !active && (
        <EmptyState icon="doc" title="No piece open" body="Head back to the Library to open or start one." />
      )}
      <TweaksLayer theme={state.theme} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
