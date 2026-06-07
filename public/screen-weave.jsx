/* Weave — separate workspace: many-file intake -> synthesis -> draft. */

function weaveWordCount(t) { return (t || "").trim() ? t.trim().split(/\s+/).length : 0; }

function SourceCard({ src, expanded, onToggle, onChange, onRemove }) {
  const wc = weaveWordCount(src.text);
  return (
    <div style={{ border: "1px solid var(--hair)", borderRadius: "var(--radius)", background: "var(--paper-2)", overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 10, alignItems: "center", padding: "10px 12px" }}>
        <button className="icon-btn" onClick={onToggle} title={expanded ? "Collapse" : "Expand"} style={{ width: 28, height: 28 }}>
          <Icon name={expanded ? "chevD" : "chevR"} size={14} />
        </button>
        <input className="field" value={src.name} onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Source name" style={{ background: "transparent", border: "1px solid transparent", padding: "4px 8px", fontFamily: "var(--font-display)", fontSize: 16, marginInline: -8 }} />
        <span className="mono muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{wc} w</span>
        <button className="icon-btn" onClick={onRemove} title="Remove" style={{ width: 28, height: 28 }}><Icon name="trash" size={13} /></button>
      </div>
      {expanded && (
        <textarea className="field" value={src.text} onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Paste this source's text…"
          style={{ borderRadius: 0, border: "none", borderTop: "1px solid var(--hair)", minHeight: 150, fontSize: 15, lineHeight: 1.6, background: "var(--paper-sunk)", resize: "vertical" }} />
      )}
    </div>
  );
}

function PhaseLine({ progress }) {
  if (!progress) return null;
  let label = "";
  const p = progress;
  if (p.phase === "extract") label = `Reading “${p.name}” — ${p.i + 1} of ${p.total}`;
  else if (p.phase === "brief") label = "Finding the emergent concept…";
  else if (p.phase === "map") label = "Mapping to your throughlines…";
  else if (p.phase === "draft") label = `Drafting “${p.name}” — ${p.i + 1} of ${p.total}`;
  else if (p.phase === "done") label = "Done";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--accent-ink)", fontSize: 14 }}>
      <Spinner size={15} /> <span>{label}</span>
    </div>
  );
}

function BriefView({ result, onCopyBrief }) {
  const { brief, mapping } = result;
  return (
    <div className="card" style={{ padding: "26px 30px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div className="eyebrow">The Brief · emergent concept</div>
        <CopyButton text={onCopyBrief} label="Copy brief" />
      </div>
      <h2 style={{ fontSize: 28, margin: "6px 0 14px", letterSpacing: "-0.01em" }}>{brief.workingTitle}</h2>

      <div style={{ padding: "14px 16px", background: "var(--accent-soft)", borderRadius: "var(--radius)", marginBottom: 16 }}>
        <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>Core message</span>
        <p style={{ fontSize: 18, margin: "4px 0 0", fontFamily: "var(--font-display)", lineHeight: 1.35 }}>{brief.coreMessage}</p>
      </div>

      <BriefRow label="Concept" text={brief.concept} />
      <BriefRow label="Connective thread" text={brief.thread} />
      {(brief.tensions || []).length > 0 && (
        <div style={{ margin: "0 0 16px" }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Productive tensions</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.5 }}>
            {brief.tensions.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
          </ul>
        </div>
      )}

      <hr className="rule" style={{ margin: "18px 0" }} />

      {/* mapping */}
      <div className="eyebrow" style={{ marginBottom: 8 }}>Mapped to your strategy</div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
        {(mapping.mapped || []).map((m, i) => (
          <span key={i} className="chip" style={{ color: "var(--accent-ink)", borderColor: "var(--accent)" }} title={m.how}><span className="dot" />{m.tag}</span>
        ))}
        {(!mapping.mapped || mapping.mapped.length === 0) && <span className="chip">no direct throughline</span>}
      </div>
      {(mapping.mapped || []).map((m, i) => (
        <div key={i} style={{ fontSize: 13.5, color: "var(--ink-2)", marginBottom: 3 }}><span className="mono" style={{ color: "var(--accent-ink)" }}>{m.tag}</span> — {m.how}</div>
      ))}
      {mapping.nearestAngle && <div style={{ fontSize: 14, marginTop: 6 }}><span className="eyebrow">Nearest angle · </span>{mapping.nearestAngle}</div>}
      <div style={{ display: "flex", gap: 18, marginTop: 12 }}>
        {mapping.audience && <div style={{ fontSize: 14 }}><span className="eyebrow">Audience · </span>{mapping.audience}</div>}
        {mapping.register && <div style={{ fontSize: 14 }}><span className="eyebrow">Register · </span>{mapping.register}</div>}
      </div>

      <hr className="rule" style={{ margin: "18px 0" }} />
      <div className="eyebrow" style={{ marginBottom: 10 }}>Structure</div>
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
        {brief.structure.map((s, i) => (
          <li key={i} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 10 }}>
            <span className="mono" style={{ color: "var(--ink-3)", fontSize: 13 }}>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 17 }}>{s.section}</div>
              <div className="muted" style={{ fontSize: 13.5 }}>{s.purpose}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BriefRow({ label, text }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6 }}>{text}</p>
    </div>
  );
}

function briefToText(result) {
  const b = result.brief, m = result.mapping;
  return [
    `WEAVE BRIEF — ${b.workingTitle}`,
    `\nCore message: ${b.coreMessage}`,
    `\nConcept: ${b.concept}`,
    `\nConnective thread: ${b.thread}`,
    (b.tensions || []).length ? `\nTensions:\n` + b.tensions.map((t) => "• " + t).join("\n") : "",
    `\nThroughlines: ` + (m.mapped || []).map((x) => `${x.tag} (${x.how})`).join("; "),
    m.nearestAngle ? `Nearest angle: ${m.nearestAngle}` : "",
    `Audience: ${m.audience || "—"}  ·  Register: ${m.register || "—"}`,
    `\nStructure:\n` + b.structure.map((s, i) => `${i + 1}. ${s.section} — ${s.purpose}`).join("\n"),
  ].filter(Boolean).join("\n");
}

function Weave({ weave, refCtx, onOpenPiece }) {
  const sources = weave.sources || [];
  const result = weave.result;
  const [expanded, setExpanded] = React.useState({});
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [view, setView] = React.useState(result ? "result" : "intake");
  const fileRef = React.useRef(null);
  const [uploading, setUploading] = React.useState(false);
  const isMobile = window.useIsMobile();

  React.useEffect(() => { if (result && !running) setView("result"); }, [result]);
  React.useEffect(() => { if (window.__weaveSourcesAdded) { window.__weaveSourcesAdded = false; setView("intake"); } }, []);

  const usableCount = sources.filter((s) => (s.text || "").trim().length > 20).length;

  const upload = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    setUploading(true); setErr(null);
    for (const f of files) {
      const base = f.name.replace(/\.[^.]+$/, "");
      const src = window.Store.addWeaveSource(base, "Reading " + f.name + "…");
      try {
        const text = await window.extractFileText(f);
        window.Store.updateWeaveSource(src.id, { text });
      } catch (err) {
        window.Store.updateWeaveSource(src.id, { text: "" });
        setErr((err && err.message) || ("Couldn't read " + f.name + "."));
      }
    }
    setUploading(false);
  };

  const run = async () => {
    setRunning(true); setErr(null); setProgress(null); setView("intake");
    try {
      const res = await window.WEAVE.runWeave(sources, refCtx, (p) => setProgress(p));
      window.Store.setWeaveResult(res);
      setView("result");
    } catch (e) { setErr(e.message || "Weave failed."); }
    setRunning(false); setProgress(null);
  };

  const sendToLibrary = () => {
    const p = window.Store.createPiece(result.brief.workingTitle);
    window.Store.updatePiece(p.id, { original: result.draft });
    onOpenPiece(p.id);
  };

  return (
    <div className="scroll-y" style={{ flex: 1 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "44px 32px 90px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Synthesis</div>
            <h1 style={{ fontSize: 42, letterSpacing: "-0.02em" }}>Weave</h1>
          </div>
          {result && view === "result" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setView("intake")}><Icon name="back" size={15} /> Sources</button>
              <button className="btn primary" onClick={sendToLibrary}>Send to Library <Icon name="arrowR" size={15} /></button>
            </div>
          )}
        </div>
        <p className="muted" style={{ fontSize: 17, marginTop: 12, maxWidth: "58ch" }}>
          Drop in many files on different topics. Each is read on its own, then fused into one
          emergent concept and a single coherent draft — built section by section so nothing is
          lost no matter how much you add.
        </p>

        {view === "intake" ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 320px", gap: isMobile ? 18 : 32, alignItems: "start", marginTop: isMobile ? 18 : 30 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div className="eyebrow">{sources.length} source{sources.length !== 1 ? "s" : ""}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input ref={fileRef} type="file" accept={window.UPLOAD_ACCEPT} multiple style={{ display: "none" }} onChange={upload} />
                  <button className="btn ghost sm" onClick={() => fileRef.current.click()} disabled={uploading} title="PDF, images, .docx, or text files">{uploading ? <><Spinner size={13} /> Reading…</> : <><Icon name="doc" size={14} /> Upload files</>}</button>
                  <button className="btn ghost sm" onClick={() => { window.Store.addWeaveSource("New source", ""); setExpanded((x) => ({ ...x })); }}><Icon name="plus" size={14} /> Add</button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sources.length === 0 && (
                  <div style={{ padding: "44px 24px", textAlign: "center", border: "1px dashed var(--hair-2)", borderRadius: "var(--radius-lg)" }}>
                    <p className="muted" style={{ fontStyle: "italic", margin: 0 }}>No sources yet. Upload PDFs, images, .docx, or text files — or add one to paste into.</p>
                  </div>
                )}
                {sources.map((s) => (
                  <SourceCard key={s.id} src={s} expanded={expanded[s.id] ?? !s.text}
                    onToggle={() => setExpanded((x) => ({ ...x, [s.id]: !(x[s.id] ?? !s.text) }))}
                    onChange={(patch) => window.Store.updateWeaveSource(s.id, patch)}
                    onRemove={() => window.Store.removeWeaveSource(s.id)} />
                ))}
              </div>
            </div>

            <div className="card" style={{ padding: "22px 22px", position: "sticky", top: 24 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Weave</div>
              <p className="muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
                Reads each source, finds the through-idea, maps it to your References, then drafts.
              </p>
              <button className="btn primary" style={{ width: "100%" }} disabled={running || usableCount < 2} onClick={run}>
                {running ? <><Spinner size={15} /> Weaving…</> : <><Icon name="play" size={15} /> Weave {usableCount} source{usableCount !== 1 ? "s" : ""}</>}
              </button>
              {usableCount < 2 && !running && <p className="muted" style={{ fontSize: 12.5, marginTop: 10, textAlign: "center" }}>Add at least two sources with text.</p>}
              {running && <div style={{ marginTop: 16 }}><PhaseLine progress={progress} /></div>}
              {err && <p style={{ color: "var(--sev-must)", fontSize: 13.5, marginTop: 12 }}>{err}</p>}
              {result && !running && (
                <button className="btn ghost sm" style={{ width: "100%", marginTop: 10 }} onClick={() => setView("result")}>View last weave <Icon name="arrowR" size={14} /></button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1fr)", gap: isMobile ? 18 : 28, alignItems: "start", marginTop: isMobile ? 18 : 28 }}>
            <BriefView result={result} onCopyBrief={() => briefToText(result)} />
            <div className="card" style={{ padding: "30px 34px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div className="eyebrow">Unified draft</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <CopyButton text={() => result.draft} label="Copy draft" />
                </div>
              </div>
              <h2 style={{ fontSize: 26, marginBottom: 16, letterSpacing: "-0.01em" }}>{result.brief.workingTitle}</h2>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 17, lineHeight: 1.76 }}>{result.draft}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--hair)" }}>
                <button className="btn primary" onClick={sendToLibrary}>Send to Library for review <Icon name="arrowR" size={15} /></button>
                <button className="btn" onClick={run} disabled={running}>{running ? <Spinner size={14} /> : <Icon name="play" size={14} />} Re-weave</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { Weave });
