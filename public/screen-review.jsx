/* Review tab — Review Packet beside the original draft.
   Findings are clickable and highlight their anchor passage. */

function packetToText(piece) {
  const p = piece.packet || {};
  let out = `REVIEW PACKET — ${piece.title}\n${"=".repeat(40)}\n`;
  window.GATES.forEach((g) => {
    const r = p[g.id]; if (!r) return;
    out += `\n${g.n}. ${g.name.toUpperCase()}\n${r.summary || ""}\n`;
    (r.findings || []).forEach((f) => {
      out += `  [${(window.SEVERITY[f.severity] || {}).label || f.severity}] ${f.title} — ${f.detail}\n`;
    });
  });
  return out;
}

function gateSectionToText(g, r) {
  let out = `${g.n}. ${g.name.toUpperCase()}\n${r.summary || ""}\n`;
  (r.findings || []).forEach((f) => {
    out += `  [${(window.SEVERITY[f.severity] || {}).label || f.severity}] ${f.title} — ${f.detail}\n`;
  });
  return out;
}

function FindingItem({ f, idx, gateId, selected, onSelect }) {
  return (
    <div onClick={() => onSelect(gateId, idx, f.anchor)}
      style={{
        display: "flex", gap: 11, padding: "11px 12px", borderRadius: "var(--radius)",
        cursor: f.anchor ? "pointer" : "default", alignItems: "flex-start",
        background: selected ? `var(${(window.SEVERITY[f.severity] || {}).bg})` : "transparent",
        border: "1px solid " + (selected ? `var(${(window.SEVERITY[f.severity] || {}).varc})` : "transparent"),
        transition: "background 0.15s",
      }}>
      <span style={{ marginTop: 6 }}><SeverityDot sev={f.severity} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <strong style={{ fontWeight: 600, fontSize: 15.5 }}>{f.title}</strong>
          {f.anchor && <Icon name="jump" size={13} style={{ color: "var(--ink-3)", flexShrink: 0, marginTop: 3 }} />}
        </div>
        <div className="muted" style={{ fontSize: 14.5, lineHeight: 1.5 }}>{f.detail}</div>
        {f.anchor && <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 5, fontStyle: "italic" }}>“{f.anchor}”</div>}
      </div>
    </div>
  );
}

const TYPE_LABEL = { historical: "Historical fact", "named-claim": "Named-party claim", empirical: "Empirical", testimony: "Testimony · exempt" };

function GateBody({ g, r, onSelect, selKey }) {
  return (
    <div>
      {/* gate-specific content */}
      {g.kind === "strategy" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {(r.servedThroughlines || []).map((t) => <span key={t} className="chip" style={{ color: "var(--accent-ink)", borderColor: "var(--accent)" }}><span className="dot" />{t}</span>)}
            {(!r.servedThroughlines || r.servedThroughlines.length === 0) && <span className="chip">no throughline served</span>}
          </div>
          {r.nearestAngle && <div style={{ fontSize: 14.5 }}><span className="eyebrow">Nearest angle · </span>{r.nearestAngle}</div>}
        </div>
      )}
      {g.kind === "audience" && (
        <div style={{ marginBottom: 12 }}>
          {r.recommended && (
            <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--accent-soft)", borderRadius: "var(--radius)" }}>
              <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>Recommended audience</span>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 18, marginTop: 2 }}>{r.recommended.name}</div>
              <div className="muted" style={{ fontSize: 14 }}>{r.recommended.why}</div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {(r.scores || []).slice().sort((a, b) => b.score - a.score).map((s) => (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 34px", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 13.5 }}>{s.name}</span>
                <div style={{ height: 5, background: "var(--paper-sunk)", borderRadius: 99 }}>
                  <div style={{ height: 5, width: `${s.score}%`, background: "var(--accent)", borderRadius: 99 }} />
                </div>
                <span className="mono muted" style={{ fontSize: 11, textAlign: "right" }}>{s.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {g.kind === "tone" && r.detectedRegister && (
        <div style={{ marginBottom: 12 }}>
          <span className="eyebrow">Detected register · </span>
          <span className="chip" style={{ color: "var(--accent-ink)", borderColor: "var(--accent)" }}>{r.detectedRegister.name}</span>
        </div>
      )}
      {g.kind === "rigor" && (r.claims || []).length > 0 && (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {(r.claims || []).map((c, i) => (
            <div key={i} style={{ padding: "9px 11px", border: "1px solid var(--hair)", borderRadius: "var(--radius)", background: "var(--paper-sunk)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14 }}>{c.text}</span>
                <span className="mono" style={{ fontSize: 10, whiteSpace: "nowrap", color: c.type === "testimony" ? "var(--ink-3)" : "var(--ink-2)" }}>{TYPE_LABEL[c.type] || c.type}</span>
              </div>
              {c.overclaimed && <div style={{ marginTop: 4 }}><SeverityTag sev="must" /> <span className="muted" style={{ fontSize: 13 }}>reads as overclaimed</span></div>}
              {c.verificationQuery && c.type !== "testimony" && (
                <div className="mono" style={{ fontSize: 11.5, color: "var(--accent-ink)", marginTop: 5 }}>⌕ {c.verificationQuery}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {g.kind === "stress" && (
        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {r.steelman && <div><span className="eyebrow">Steelman</span><p style={{ fontSize: 14.5, margin: "4px 0 0" }}>{r.steelman}</p></div>}
          {(r.counters || []).length > 0 && (
            <div><span className="eyebrow">Next-strongest counters</span>
              <ol style={{ margin: "4px 0 0", paddingLeft: 20, fontSize: 14.5 }}>{r.counters.map((c, i) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}</ol>
            </div>
          )}
          {(r.screenshotTests || []).length > 0 && (
            <div><span className="eyebrow">Screenshot test</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 5 }}>
                {r.screenshotTests.map((s, i) => (
                  <div key={i} style={{ padding: "9px 11px", border: "1px solid var(--sev-must)", borderRadius: "var(--radius)", background: "var(--sev-must-bg)" }}>
                    <div className="mono" style={{ fontSize: 12, fontStyle: "italic" }}>“{s.quote}”</div>
                    <div style={{ fontSize: 13.5, marginTop: 5 }}><span className="eyebrow" style={{ color: "var(--sev-must)" }}>Misread · </span>{s.misread}</div>
                    <div style={{ fontSize: 13.5, marginTop: 4 }}><span className="eyebrow" style={{ color: "var(--st-approved)" }}>Inoculate · </span>{s.inoculation}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* findings */}
      {(r.findings || []).length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {r.findings.map((f, i) => (
            <FindingItem key={i} f={f} idx={i} gateId={g.id} onSelect={onSelect}
              selected={selKey === g.id + ":" + i} />
          ))}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 14, fontStyle: "italic", padding: "4px 0" }}>No findings — this gate is clear.</div>
      )}
    </div>
  );
}

function OriginalPane({ text, anchor, bump }) {
  const scroller = React.useRef(null);
  const mark = React.useRef(null);
  React.useEffect(() => {
    if (mark.current && scroller.current) {
      const c = scroller.current, m = mark.current;
      c.scrollTo({ top: m.offsetTop - c.clientHeight / 2 + m.clientHeight / 2, behavior: "smooth" });
    }
  }, [bump]);

  let body;
  if (anchor && text) {
    const lc = text.toLowerCase(), idx = lc.indexOf(anchor.toLowerCase());
    if (idx >= 0) {
      body = <>{text.slice(0, idx)}<mark ref={mark} style={{ background: "var(--accent-soft)", color: "var(--ink)", borderBottom: "2px solid var(--accent)", borderRadius: 2, padding: "1px 0" }}>{text.slice(idx, idx + anchor.length)}</mark>{text.slice(idx + anchor.length)}</>;
    } else { body = text; }
  } else { body = text; }

  return (
    <div ref={scroller} className="scroll-y" style={{ height: "100%" }}>
      <div style={{ padding: "30px 34px", maxWidth: "62ch", margin: "0 auto", whiteSpace: "pre-wrap", fontSize: 17.5, lineHeight: 1.75 }}>
        {body}
      </div>
    </div>
  );
}

function MicButton({ listening, onClick, title }) {
  return (
    <button className="btn ghost sm" onClick={onClick} title={title || "Dictate"}
      style={listening ? { borderColor: "var(--sev-must)", color: "var(--sev-must)" } : undefined}>
      <Icon name="mic" size={13} /> {listening ? "Listening…" : "Dictate"}
    </button>
  );
}

// Web Speech dictation helper shared by the commentary + direction boxes.
function useDictation(getBase, onText, onDone) {
  const recRef = React.useRef(null);
  const [listening, setListening] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  React.useEffect(() => () => { try { recRef.current && recRef.current.stop(); } catch (e) {} }, []);
  const toggle = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setMsg("Voice dictation isn't supported in this browser."); return; }
    if (listening) { try { recRef.current && recRef.current.stop(); } catch (e) {} return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    let base = getBase() ? getBase() + " " : "";
    rec.onresult = (e) => {
      let interim = "", finalAdd = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalAdd += t; else interim += t;
      }
      if (finalAdd) base += finalAdd;
      onText((base + interim).replace(/\s+/g, " ").trim());
    };
    rec.onerror = () => { setMsg("Dictation error."); setListening(false); };
    rec.onend = () => { setListening(false); recRef.current = null; onDone && onDone(); };
    recRef.current = rec; setMsg(null); setListening(true);
    try { rec.start(); } catch (e) { setListening(false); }
  };
  return { listening, msg, toggle };
}

function CommentaryBox({ piece, gateId }) {
  const noteOf = (p) => (p.gateNotes && p.gateNotes[gateId]) || "";
  const [open, setOpen] = React.useState(!!noteOf(piece));
  const valRef = React.useRef(noteOf(piece));
  const [val, setValState] = React.useState(noteOf(piece));
  const setVal = (v) => { valRef.current = v; setValState(v); };
  React.useEffect(() => { setVal(noteOf(piece)); /* resync on piece switch */ }, [piece.id]);
  const persist = () => {
    const v = valRef.current.trim();
    if (v === noteOf(piece).trim()) return;
    window.Store.updatePiece(piece.id, { gateNotes: Object.assign({}, piece.gateNotes || {}, { [gateId]: v }) });
  };
  const dict = useDictation(() => valRef.current, (t) => setVal(t), () => persist());
  const openAnd = (fn) => { setOpen(true); fn(); };

  if (!open) {
    return (
      <div style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
        <button className="btn ghost sm" onClick={() => setOpen(true)}><Icon name="book" size={13} /> Add commentary</button>
        <MicButton listening={dict.listening} onClick={() => openAnd(dict.toggle)} title="Dictate commentary" />
        {dict.msg && <span className="muted" style={{ fontSize: 12 }}>{dict.msg}</span>}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span className="eyebrow">Your commentary</span>
        <MicButton listening={dict.listening} onClick={dict.toggle} title="Dictate commentary" />
      </div>
      <textarea className="field" value={val} onChange={(e) => setVal(e.target.value)} onBlur={persist}
        placeholder="Notes for the revision on this section — typed, pasted, or dictated…"
        style={{ width: "100%", minHeight: 60, fontSize: 14, lineHeight: 1.5, resize: "vertical" }} />
      {dict.msg && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{dict.msg}</div>}
    </div>
  );
}

function DirectionBox({ piece }) {
  const [val, setVal] = React.useState(piece.direction || "");
  const valRef = React.useRef(piece.direction || "");
  const set = (v) => { valRef.current = v; setVal(v); };
  React.useEffect(() => { set(piece.direction || ""); }, [piece.id]);
  const persist = () => {
    if (valRef.current.trim() === (piece.direction || "").trim()) return;
    window.Store.updatePiece(piece.id, { direction: valRef.current.trim() });
  };
  const dict = useDictation(() => valRef.current, (t) => set(t), () => persist());
  return (
    <div style={{ marginBottom: 18, padding: "12px 14px", border: "1px solid var(--hair)", borderRadius: "var(--radius)", background: "var(--paper-sunk)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span className="eyebrow">Creative direction · applies throughout</span>
        <MicButton listening={dict.listening} onClick={dict.toggle} title="Dictate direction" />
      </div>
      <textarea className="field" value={val} onChange={(e) => set(e.target.value)} onBlur={persist}
        placeholder="Overall direction for the rewrite — emphasis, angle, tone. Takes precedence over findings (in your voice)."
        style={{ width: "100%", minHeight: 54, fontSize: 14, lineHeight: 1.5, resize: "vertical" }} />
      {dict.msg && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{dict.msg}</div>}
    </div>
  );
}

function ReviewTab({ piece }) {
  const isMobile = window.useIsMobile();
  const [sel, setSel] = React.useState({ key: null, anchor: null, bump: 0 });
  const [sevFilter, setSevFilter] = React.useState({ must: true, consider: true, note: true });
  const [mView, setMView] = React.useState("packet"); // mobile: packet | original
  const packet = piece.packet || {};

  const onSelect = (gateId, idx, anchor) => {
    setSel((s) => ({ key: gateId + ":" + idx, anchor: anchor || null, bump: s.bump + 1 }));
    if (isMobile && anchor) setMView("original"); // tapping a finding reveals the passage
  };

  const counts = { must: 0, consider: 0, note: 0 };
  window.GATES.forEach((g) => { const r = packet[g.id]; if (r) r.findings.forEach((f) => counts[f.severity]++); });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {isMobile && (
        <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--hair)", flexShrink: 0 }}>
          {[["packet", "Review Packet"], ["original", "Your Original"]].map(([id, l]) => {
            const on = mView === id;
            return (
              <button key={id} onClick={() => setMView(id)} className="mono"
                style={{ flex: 1, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", padding: "9px 4px", borderRadius: 999, border: "none", cursor: "pointer",
                  background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent-ink)" : "var(--ink-3)" }}>{l}</button>
            );
          })}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
      {/* Packet */}
      <div className="scroll-y" style={{ borderRight: isMobile ? "none" : "1px solid var(--hair)", height: "100%", display: isMobile && mView !== "packet" ? "none" : "block" }}>
        <div style={{ padding: "26px 28px 80px", maxWidth: 640, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div className="eyebrow">Review Packet</div>
            <CopyButton text={() => packetToText(piece)} label="Copy packet" />
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            {["must", "consider", "note"].map((sv) => {
              const on = sevFilter[sv]; const s = window.SEVERITY[sv];
              return (
                <button key={sv} onClick={() => setSevFilter((f) => ({ ...f, [sv]: !f[sv] }))}
                  className="mono" style={{
                    fontSize: 11, padding: "5px 10px", borderRadius: 999, cursor: "pointer",
                    border: "1px solid " + (on ? `var(${s.varc})` : "var(--hair)"),
                    background: on ? `var(${s.bg})` : "transparent",
                    color: on ? `var(${s.varc})` : "var(--ink-3)",
                  }}>{s.label} {counts[sv]}</button>
              );
            })}
          </div>

          <DirectionBox piece={piece} />

          {window.GATES.map((g) => {
            const r = packet[g.id]; if (!r) return null;
            const filtered = { ...r, findings: r.findings.filter((f) => sevFilter[f.severity]) };
            return (
              <div key={g.id} id={"gate-" + g.id} style={{ marginBottom: 26 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--hair-2)", paddingBottom: 8, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 21 }}><span className="mono" style={{ fontSize: 13, color: "var(--ink-3)", marginRight: 8 }}>{String(g.n).padStart(2, "0")}</span>{g.name}</h3>
                  <CopyButton text={() => gateSectionToText(g, r)} label="" />
                </div>
                {r.summary && <p style={{ fontSize: 15, color: "var(--ink-2)", marginBottom: 12 }}>{r.summary}</p>}
                <GateBody g={g} r={filtered} onSelect={onSelect} selKey={sel.key} />
                <CommentaryBox piece={piece} gateId={g.id} />
              </div>
            );
          })}
        </div>
      </div>
      {/* Original */}
      <div style={{ height: "100%", display: isMobile && mView !== "original" ? "none" : "flex", flexDirection: "column", minHeight: 0, background: "var(--paper-2)" }}>
        <div style={{ padding: isMobile ? "12px 16px" : "16px 34px", borderBottom: "1px solid var(--hair)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="eyebrow">Your Original</div>
          {sel.anchor && <button className="btn ghost sm" onClick={() => setSel({ key: null, anchor: null, bump: sel.bump })}>Clear highlight</button>}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <OriginalPane text={piece.original} anchor={sel.anchor} bump={sel.bump} />
        </div>
      </div>
      </div>
    </div>
  );
}

Object.assign(window, { ReviewTab, packetToText });
