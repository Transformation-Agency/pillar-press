/* References — editable-in-place source documents. The gates and
   generators always read the current versions (refContext reads live
   Store state at call time). Read-only for the Assistant role. */

function AutoText({ value, onCommit, readOnly, style, placeholder, mono }) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { setV(value); }, [value]);
  if (readOnly) return <div style={{ whiteSpace: "pre-wrap", ...style }}>{v || <span className="muted">{placeholder}</span>}</div>;
  return (
    <textarea value={v} placeholder={placeholder}
      onChange={(e) => { setV(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
      onBlur={() => v !== value && onCommit(v)}
      ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
      className={"field" + (mono ? " mono" : "")}
      style={{ resize: "none", overflow: "hidden", background: "transparent", border: "1px solid transparent", padding: "6px 8px", marginInline: -8, ...style }}
      onFocus={(e) => { e.target.style.background = "var(--paper-sunk)"; e.target.style.borderColor = "var(--hair)"; }}
    />
  );
}

function RefSection({ icon, title, children, right }) {
  return (
    <section style={{ marginBottom: 18 }} className="card">
      <div style={{ padding: "18px 26px", borderBottom: "1px solid var(--hair)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 22, display: "flex", alignItems: "center", gap: 11 }}>
          <Icon name={icon} size={18} style={{ color: "var(--accent)" }} />{title}
        </h3>
        {right}
      </div>
      <div style={{ padding: "20px 26px" }}>{children}</div>
    </section>
  );
}

function EntryList({ entries, fields, onChange, readOnly }) {
  const update = (i, key, val) => { const next = entries.map((e, j) => j === i ? { ...e, [key]: val } : e); onChange(next); };
  const remove = (i) => onChange(entries.filter((_, j) => j !== i));
  const add = () => onChange([...entries, fields.reduce((o, f) => (o[f.key] = "", o), {})]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {entries.map((e, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: readOnly ? "1fr" : "1fr 30px", gap: 8, alignItems: "start", paddingBottom: 12, borderBottom: i < entries.length - 1 ? "1px solid var(--hair)" : "none" }}>
          <div>
            {fields.map((f) => f.key === "tag" || f.key === "id" ? (
              <span key={f.key} className="mono" style={{ display: "inline-block", marginBottom: 4 }}>
                {readOnly ? <span className="chip">{e[f.key]}</span> :
                  <input className="field mono" value={e[f.key] || ""} placeholder={f.ph}
                    onChange={(ev) => update(i, f.key, ev.target.value)}
                    style={{ width: "auto", minWidth: 120, fontSize: 12, padding: "3px 9px", borderRadius: 999, background: "var(--accent-soft)", border: "1px solid var(--hair)", color: "var(--accent-ink)" }} />}
              </span>
            ) : (
              <AutoText key={f.key} value={e[f.key] || ""} readOnly={readOnly} placeholder={f.ph}
                onCommit={(val) => update(i, f.key, val)}
                style={f.key === "name" ? { fontFamily: "var(--font-display)", fontSize: 17 } : { fontSize: 14.5, color: "var(--ink-2)" }} />
            ))}
          </div>
          {!readOnly && <button className="icon-btn" onClick={() => remove(i)} title="Remove" style={{ width: 28, height: 28 }}><Icon name="trash" size={13} /></button>}
        </div>
      ))}
      {!readOnly && <button className="btn ghost sm" onClick={add} style={{ alignSelf: "flex-start" }}><Icon name="plus" size={13} /> Add</button>}
    </div>
  );
}

function RuleList({ rules, onChange, readOnly }) {
  const update = (i, val) => onChange(rules.map((r, j) => j === i ? val : r));
  const remove = (i) => onChange(rules.filter((_, j) => j !== i));
  const add = () => onChange([...rules, ""]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rules.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: readOnly ? "24px 1fr" : "24px 1fr 30px", gap: 8, alignItems: "start" }}>
          <span className="mono" style={{ color: "var(--ink-3)", fontSize: 13, paddingTop: 7 }}>{String(i + 1).padStart(2, "0")}</span>
          <AutoText value={r} readOnly={readOnly} onCommit={(v) => update(i, v)} style={{ fontSize: 15 }} />
          {!readOnly && <button className="icon-btn" onClick={() => remove(i)} style={{ width: 28, height: 28 }}><Icon name="trash" size={13} /></button>}
        </div>
      ))}
      {!readOnly && <button className="btn ghost sm" onClick={add} style={{ alignSelf: "flex-start" }}><Icon name="plus" size={13} /> Add rule</button>}
    </div>
  );
}

/* Edit the whole references doc from a plain-language instruction (author only).
   Generates a proposed doc + summary server-side; the author reviews, then applies. */
function RefsAIModal({ campaignId, onClose, onApply }) {
  const [instruction, setInstruction] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [result, setResult] = React.useState(null); // { doc, summary }
  const [uploading, setUploading] = React.useState(false);
  const [attached, setAttached] = React.useState([]); // file names attached
  const fileRef = React.useRef(null);

  const attach = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    setUploading(true); setErr(null);
    for (const f of files) {
      try {
        const text = await window.extractFileText(f);
        setInstruction((prev) =>
          (prev ? prev.trim() + "\n\n" : "") +
          "Source material from \"" + f.name + "\":\n\"\"\"\n" + text.slice(0, 16000) + "\n\"\"\"");
        setAttached((a) => [...a, f.name]);
      } catch (err) { setErr((err && err.message) || ("Couldn't read " + f.name + ".")); }
    }
    setUploading(false);
  };

  const generate = async () => {
    if (instruction.trim().length < 3) { setErr("Describe the change you want."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/campaigns/" + campaignId + "/references/ai-edit", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin", body: JSON.stringify({ instruction: instruction.trim() }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error((data && data.error) || (r.status === 403 ? "Switch to Author to edit References." : "Couldn't generate the edit."));
      setResult(data);
    } catch (e) { setErr((e && e.message) || "Couldn't generate the edit."); }
    setBusy(false);
  };
  const apply = () => { if (result && result.doc) onApply(result.doc); onClose(); };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(560px, 96vw)", maxHeight: "88vh", overflowY: "auto", padding: "22px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="eyebrow">Edit references with AI</div>
          <button className="icon-btn" onClick={onClose} style={{ width: 30, height: 30 }}><Icon name="xLogo" size={14} /></button>
        </div>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 0, marginBottom: 12 }}>
          Describe the change in plain language. AI revises the whole references document — you review a summary before anything is applied, and your wording is preserved where the change doesn't touch it.
        </p>
        <textarea className="field" value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy || !!result}
          placeholder={"e.g. Add an audience for skeptical executives, and make the red lines more specific. — or attach a brand doc / bio and say 'fold this in.'"}
          style={{ minHeight: 110, fontSize: 15, lineHeight: 1.55, resize: "vertical" }} />
        {!result && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <input ref={fileRef} type="file" accept={window.UPLOAD_ACCEPT} multiple style={{ display: "none" }} onChange={attach} />
            <button className="btn ghost sm" onClick={() => fileRef.current.click()} disabled={busy || uploading} title="Attach a PDF, image, .docx, or text file as source material">
              {uploading ? <><Spinner size={13} /> Reading…</> : <><Icon name="doc" size={13} /> Attach document</>}
            </button>
            {attached.length > 0 && <span className="mono muted" style={{ fontSize: 11 }}>{attached.length} attached: {attached.join(", ").slice(0, 60)}</span>}
          </div>
        )}
        {err && <div style={{ color: "var(--sev-must)", fontSize: 13, marginTop: 8 }}>{err}</div>}
        {result && (
          <div className="card" style={{ background: "var(--paper-sunk)", padding: "12px 14px", marginTop: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Proposed change</div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{result.summary}</div>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          {!result ? (
            <>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={generate} disabled={busy}>{busy ? <><Spinner size={14} /> Drafting…</> : <><Icon name="sparkle" size={14} /> Generate</>}</button>
            </>
          ) : (
            <>
              <button className="btn ghost" onClick={() => setResult(null)}>Try again</button>
              <button className="btn primary" onClick={apply}><Icon name="check" size={14} /> Apply changes</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function References({ refs, role, campaignName }) {
  const readOnly = role === "assistant";
  const [aiOpen, setAiOpen] = React.useState(false);
  const campaignId = window.Store.getState().activeCampaignId;
  const set = (key, value) => window.Store.setReferenceSection(key, value);
  const patch = (key, sub) => set(key, { ...refs[key], ...sub });

  return (
    <div className="scroll-y" style={{ flex: 1 }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "46px 32px 90px" }}>
        {aiOpen && <RefsAIModal campaignId={campaignId} onClose={() => setAiOpen(false)} onApply={(doc) => window.Store.updateReferences(doc)} />}
        <div className="eyebrow" style={{ marginBottom: 8 }}>{campaignName ? campaignName + " · guidelines" : "Source of truth"}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <h1 style={{ fontSize: 42, letterSpacing: "-0.02em", margin: 0 }}>References</h1>
          {!readOnly && <button className="btn" onClick={() => setAiOpen(true)} title="Revise the references document with AI"><Icon name="sparkle" size={15} /> Edit with AI</button>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderRadius: "var(--radius)", background: readOnly ? "var(--paper-sunk)" : "var(--accent-soft)", marginBottom: 30 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: readOnly ? "var(--ink-3)" : "var(--accent)", animation: readOnly ? "none" : "pulse 2s infinite" }} />
          <span style={{ fontSize: 14, color: readOnly ? "var(--ink-2)" : "var(--accent-ink)" }}>
            {readOnly ? "Read-only — switch to Author to edit. The assistant role can view but not change References." : "Live — every gate and generator reads the current version, the moment you run."}
          </span>
        </div>

        <RefSection icon="flag" title="Content Strategy">
          <div style={{ marginBottom: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Throughlines</div>
            <EntryList entries={refs.strategy.throughlines} readOnly={readOnly}
              fields={[{ key: "tag", ph: "tag" }, { key: "name", ph: "Name" }, { key: "note", ph: "What it means" }]}
              onChange={(v) => patch("strategy", { throughlines: v })} />
          </div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Strategy note</div>
          <AutoText value={refs.strategy.body} readOnly={readOnly} onCommit={(v) => patch("strategy", { body: v })} style={{ fontSize: 15 }} />
        </RefSection>

        <RefSection icon="book" title="Defined Audiences">
          <EntryList entries={refs.audiences.list} readOnly={readOnly}
            fields={[{ key: "id", ph: "id" }, { key: "name", ph: "Name" }, { key: "note", ph: "Who they are" }]}
            onChange={(v) => patch("audiences", { list: v })} />
        </RefSection>

        <RefSection icon="book" title="Voice — Two Registers">
          <EntryList entries={refs.registers.list} readOnly={readOnly}
            fields={[{ key: "id", ph: "id" }, { key: "name", ph: "Name" }, { key: "note", ph: "Description" }]}
            onChange={(v) => patch("registers", { list: v })} />
          <div className="eyebrow" style={{ margin: "14px 0 4px" }}>Detection note</div>
          <AutoText value={refs.registers.body} readOnly={readOnly} onCommit={(v) => patch("registers", { body: v })} style={{ fontSize: 15 }} />
        </RefSection>

        <RefSection icon="doc" title="Clarity & Communication Rules">
          <RuleList rules={refs.voiceRules.rules} readOnly={readOnly} onChange={(v) => patch("voiceRules", { rules: v })} />
        </RefSection>

        <RefSection icon="warn" title="Red Lines & Boundaries">
          <RuleList rules={refs.redLines.rules} readOnly={readOnly} onChange={(v) => patch("redLines", { rules: v })} />
        </RefSection>

        <RefSection icon="book" title="Self-Vision — Public Identity">
          <AutoText value={refs.selfVision.body} readOnly={readOnly} onCommit={(v) => patch("selfVision", { body: v })} style={{ fontSize: 16, lineHeight: 1.7 }} />
        </RefSection>

        <RefSection icon="gear" title="Gate Specification">
          <AutoText value={refs.gateSpec.body} readOnly={readOnly} onCommit={(v) => patch("gateSpec", { body: v })} style={{ fontSize: 16, lineHeight: 1.7 }} />
        </RefSection>
      </div>
    </div>
  );
}

Object.assign(window, { References });
