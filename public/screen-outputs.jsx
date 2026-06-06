/* Outputs tab — platform toggles, audience presets, provenance diagram,
   fixed-order generation, and one result card per platform. */

const PLAT_AUD_DEFAULT = { substack: "builders", facebook: "relational", instagram: "women-ai", x: "builders", threads: "general" };

function derivationLabel(pid, activeIds) {
  const src = window.GEN.resolveSources(activeIds)[pid] || ["__source__"];
  if (src[0] === "__source__") return "from Source";
  return "from " + src.map((s) => s[0].toUpperCase() + s.slice(1)).join(" + ");
}

function ProvenanceMap({ activeIds, prog }) {
  const ordered = window.GEN.PLATFORMS.filter((p) => activeIds.includes(p.id));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap", rowGap: 12 }}>
      <Node label="Source" sub="canonical" tone="source" />
      {ordered.length === 0 && <span className="muted" style={{ fontSize: 14, marginLeft: 14, fontStyle: "italic" }}>Toggle a platform on to see the chain.</span>}
      {ordered.map((p, i) => (
        <React.Fragment key={p.id}>
          <Connector />
          <Node label={p.name} sub={derivationLabel(p.id, activeIds)} status={prog[p.id]} />
        </React.Fragment>
      ))}
    </div>
  );
}

function Connector() {
  return <svg width="26" height="14" viewBox="0 0 26 14" style={{ flexShrink: 0, color: "var(--hair-2)" }}><path d="M0 7h22M18 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Node({ label, sub, tone, status }) {
  const done = status === "done", running = status === "running";
  return (
    <div style={{
      padding: "9px 13px", borderRadius: "var(--radius)", textAlign: "center",
      border: "1px solid " + (tone === "source" ? "var(--hair-2)" : done ? "var(--accent)" : "var(--hair)"),
      background: tone === "source" ? "var(--paper-sunk)" : done ? "var(--accent-soft)" : "var(--paper-2)",
      minWidth: 92,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
        {running && <Spinner size={12} />}
        {done && <Icon name="check" size={13} style={{ color: "var(--accent)" }} />}
        <span style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>{label}</span>
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: "0.03em", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button onClick={onChange} style={{
      width: 40, height: 23, borderRadius: 999, border: "none", cursor: "pointer", padding: 2,
      background: on ? "var(--accent)" : "var(--hair-2)", transition: "background 0.2s", flexShrink: 0,
    }}>
      <span style={{ display: "block", width: 19, height: 19, borderRadius: 999, background: "var(--paper-2)", transform: on ? "translateX(17px)" : "translateX(0)", transition: "transform 0.2s", boxShadow: "var(--shadow-sm)" }} />
    </button>
  );
}

function outputToText(o) {
  return [
    `${o.platform} · ${o.selectedAudience} · #${o.throughlineTag}`,
    `Purpose: ${o.strategicPurpose}`, "",
    o.draftPost, "",
    "HOOKS:", ...(o.hooks || []).map((h) => "• " + h), "",
    "CTAs:", ...(o.ctas || []).map((c) => "• " + c), "",
    `Media: ${o.mediaRec}`,
    `Risk check: ${o.riskCheck}`,
    `Related: ${o.relatedOffering}`,
    `Follow-up: ${o.followUp}`,
  ].join("\n");
}

function outputFilename(o) { return window.EXPORT.safeName(o.platform) + ".md"; }
function downloadOutput(o) { window.EXPORT.downloadText(window.EXPORT.outputMarkdown(o), outputFilename(o)); }
function outputFiles(piece) {
  return (piece.outputOrder || []).map((pid) => piece.outputs[pid]).filter(Boolean)
    .map((o) => ({ name: outputFilename(o), content: window.EXPORT.outputMarkdown(o), mime: "text/markdown" }));
}
function downloadAllOutputs(piece) {
  const files = outputFiles(piece); if (!files.length) return;
  window.EXPORT.downloadBlob(window.EXPORT.zipBlob(files), window.EXPORT.safeName(piece.title) + "-outputs.zip");
}
async function driveSave(files, setMsg) {
  if (!window.DRIVE.isConfigured()) { setMsg({ t: "link", m: "Link a Google Drive folder first." }); return; }
  try {
    setMsg({ t: "busy", m: files.length > 1 ? `Saving ${files.length} files to Drive…` : `Saving ${files[0].name} to Drive…` });
    const res = await window.DRIVE.uploadMany(files, (i, n, name) => setMsg({ t: "busy", m: `Saving ${i + 1}/${n}: ${name}` }));
    const link = res[res.length - 1] && res[res.length - 1].webViewLink;
    setMsg({ t: "ok", m: files.length > 1 ? `Saved ${files.length} files to Drive.` : `Saved to Drive.`, link });
  } catch (e) { setMsg({ t: "err", m: e.message || "Drive save failed." }); }
}

function DriveDialog({ onClose }) {
  const cfg = window.Store.getSettings().drive || {};
  const [clientId, setClientId] = React.useState(cfg.clientId || "");
  const [folderId, setFolderId] = React.useState(cfg.folderId || "");
  const save = () => { window.Store.setDriveConfig({ clientId: clientId.trim(), folderId: folderId.trim() }); onClose(); };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "grid", placeItems: "center", zIndex: 80 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 540, maxWidth: "92vw", padding: "26px 28px" }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Connect</div>
        <h2 style={{ fontSize: 24, marginBottom: 10 }}>Link a Google Drive folder</h2>
        <p className="muted" style={{ fontSize: 14, marginBottom: 18 }}>
          Saving to your Drive needs your own Google OAuth <strong>Client ID</strong> (Web application, with this app's URL added as an authorized JavaScript origin) and the destination <strong>Folder ID</strong> (the long string at the end of the folder's URL). Files use the <span className="mono">drive.file</span> scope. If sign-in is blocked here, use Download instead — it produces the same files.
        </p>
        <label className="eyebrow" style={{ display: "block", marginBottom: 5 }}>OAuth Client ID</label>
        <input className="field" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxxx.apps.googleusercontent.com" style={{ marginBottom: 14, fontFamily: "var(--font-mono)", fontSize: 13 }} />
        <label className="eyebrow" style={{ display: "block", marginBottom: 5 }}>Destination Folder ID <span style={{ textTransform: "none", letterSpacing: 0 }} className="muted">(optional — blank = My Drive root)</span></label>
        <input className="field" value={folderId} onChange={(e) => setFolderId(e.target.value)} placeholder="1AbC…folderId" style={{ marginBottom: 22, fontFamily: "var(--font-mono)", fontSize: 13 }} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save link</button>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M19.6 10.2c0-.7-.1-1.3-.2-2H10v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" opacity=".9"/><path fill="currentColor" d="M10 20c2.7 0 5-.9 6.6-2.5l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H1.1v2.6A10 10 0 0 0 10 20z" opacity=".7"/><path fill="currentColor" d="M4.4 11.9a6 6 0 0 1 0-3.8V5.5H1.1a10 10 0 0 0 0 9z" opacity=".5"/><path fill="currentColor" d="M10 4c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 1.1 5.5l3.3 2.6C5.2 5.7 7.4 4 10 4z" opacity=".8"/></svg>;
}

function OutputCard({ o, derivation, pieceId, platform, onCondensed, onDrive, onVideo, onImage }) {
  const isMobile = window.useIsMobile();
  const clear = /clear|none|no concern|pass/i.test(o.riskCheck || "");
  const [condensing, setCondensing] = React.useState(false);
  const [cerr, setCerr] = React.useState(null);
  const [ratio, setRatio] = React.useState(0.4);
  const [hist, setHist] = React.useState([]); // stack of prior draftPost versions (multi-level undo)
  const pct = Math.round(ratio * 100);
  const wc = (s) => (s || "").trim().split(/\s+/).filter(Boolean).length;
  const wordCount = wc(o.draftPost);
  const prevWords = hist.length ? wc(hist[hist.length - 1]) : null;
  const condense = async () => {
    if (!pieceId || condensing) return;
    const before = o.draftPost || "";
    setCondensing(true); setCerr(null);
    try {
      const r = await window.GEN.condenseOutput(pieceId, platform, ratio);
      setHist((h) => h.concat([before]));
      if (onCondensed) onCondensed(platform, r.draftPost);
    } catch (e) { setCerr((e && e.message) || "Couldn't condense."); }
    setCondensing(false);
  };
  const undo = () => {
    if (!hist.length) return;
    const last = hist[hist.length - 1];
    setHist((h) => h.slice(0, -1));
    if (onCondensed) onCondensed(platform, last);
  };
  return (
    <div className="card fade-in" style={{ padding: "24px 26px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ fontSize: 23 }}>{o.platform}</h3>
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{derivation}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
            <span className="chip">{o.selectedAudience}</span>
            <span className="chip" style={{ color: "var(--accent-ink)", borderColor: "var(--accent)" }}>#{o.throughlineTag}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <CopyButton text={() => outputToText(o)} label="Copy" />
          <button className="btn ghost sm" onClick={() => downloadOutput(o)} title="Download .md"><Icon name="doc" size={14} /> Download</button>
          <button className="btn ghost sm" onClick={() => onDrive && onDrive(o)} title="Save to Google Drive"><GoogleIcon size={13} /> Drive</button>
          {onImage && <button className="btn ghost sm" onClick={() => onImage(o)} title="Generate an image for this post"><Icon name="image" size={14} /> Image</button>}
          {onVideo && <button className="btn ghost sm" onClick={() => onVideo(o)} title="Turn this post into a narrated video"><Icon name="film" size={14} /> Video</button>}
        </div>
      </div>

      <p style={{ fontSize: 14, color: "var(--ink-2)", marginBottom: 16 }}><span className="eyebrow">Purpose · </span>{o.strategicPurpose}</p>

      <div style={{ whiteSpace: "pre-wrap", fontSize: 16.5, lineHeight: 1.7, padding: "18px 20px", background: "var(--paper-sunk)", borderRadius: "var(--radius)", marginBottom: 12 }}>{o.draftPost}</div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <button className="btn ghost sm" onClick={condense} disabled={condensing} title="Rewrite this post shorter (post only — hooks, CTAs and metadata untouched)">
          {condensing ? <><Spinner size={13} /> Condensing…</> : "Make " + pct + "% shorter"}
        </button>
        <input type="range" min="20" max="60" step="5" value={pct} disabled={condensing}
          onChange={(e) => setRatio(Number(e.target.value) / 100)}
          aria-label="Reduction amount" title={"Reduce by " + pct + "%"} style={{ width: 110, accentColor: "var(--accent)" }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{pct}% · {wordCount} words{prevWords != null ? " (was " + prevWords + ")" : ""}</span>
        {hist.length > 0 && !condensing &&
          <button className="btn ghost sm" onClick={undo} title="Restore the previous version of this post">Undo{hist.length > 1 ? " (" + hist.length + ")" : ""}</button>}
        {cerr && <span style={{ fontSize: 13, color: "var(--sev-must)" }}>{cerr}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 10 : 18, marginBottom: 16 }}>
        <Field label="Hook options" items={o.hooks} />
        <Field label="CTA options" items={o.ctas} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--hair)", paddingTop: 16 }}>
        <Line label="Imagery / media" value={o.mediaRec} />
        <Line label="Related offering" value={o.relatedOffering} />
        <Line label="Suggested follow-up" value={o.followUp} />
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span className="eyebrow" style={{ minWidth: 110, paddingTop: 2 }}>Risk & boundary</span>
          <span style={{ fontSize: 14.5, display: "flex", gap: 7, alignItems: "center", color: clear ? "var(--st-approved)" : "var(--sev-must)" }}>
            <Icon name={clear ? "check" : "warn"} size={15} />{o.riskCheck}
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, items }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 14.5, lineHeight: 1.5 }}>
        {(items || []).map((x, i) => <li key={i} style={{ marginBottom: 4 }}>{x}</li>)}
      </ul>
    </div>
  );
}
function Line({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span className="eyebrow" style={{ minWidth: 110, paddingTop: 2 }}>{label}</span>
      <span style={{ fontSize: 14.5 }}>{value}</span>
    </div>
  );
}

function OutputsTab({ piece, onUpdate, refCtx, onGoStudio }) {
  const isMobile = window.useIsMobile();
  const init = piece.outputSettings || {};
  const [active, setActive] = React.useState(init.active || ["substack", "facebook"]);
  const [auds, setAuds] = React.useState(init.audiences || { ...PLAT_AUD_DEFAULT });
  const [busy, setBusy] = React.useState(false);
  const [prog, setProg] = React.useState({});
  const [err, setErr] = React.useState(null);
  const [driveOpen, setDriveOpen] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const onDriveOne = (o) => { if (!window.DRIVE.isConfigured()) { setDriveOpen(true); return; } driveSave([{ name: outputFilename(o), content: window.EXPORT.outputMarkdown(o), mime: "text/markdown" }], setMsg); };
  const onVideo = (o) => { window.__studioPrefill = { type: "avatar", pieceId: piece.id, prompt: o.platform + " — " + (o.strategicPurpose || ""), script: o.draftPost || "" }; onGoStudio && onGoStudio(); };
  const onImage = (o) => { window.__studioPrefill = { type: "image", pieceId: piece.id, prompt: o.mediaRec || o.strategicPurpose || (o.platform + " post art") }; onGoStudio && onGoStudio(); };
  const onCondensed = (platform, draftPost) => {
    const outputs = Object.assign({}, piece.outputs, { [platform]: Object.assign({}, piece.outputs[platform], { draftPost }) });
    onUpdate({ outputs });
  };

  const orderedActive = window.GEN.PLATFORMS.filter((p) => active.includes(p.id)).map((p) => p.id);

  const toggle = (id) => setActive((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id]);

  const generate = async () => {
    if (orderedActive.length === 0) return;
    setBusy(true); setErr(null);
    const p0 = {}; orderedActive.forEach((id) => p0[id] = "pending"); setProg(p0);
    try {
      const { outputs, order } = await window.GEN.generateOutputs(
        piece, orderedActive, auds, refCtx,
        (pid, status) => setProg((p) => ({ ...p, [pid]: status }))
      );
      onUpdate({ outputs, outputOrder: order, outputSettings: { active: orderedActive, audiences: auds } });
    } catch (e) { setErr(e.message || "Generation failed."); }
    setBusy(false);
  };

  if (!piece.original || !piece.original.trim()) {
    return <EmptyState icon="doc" title="No source yet" body="Add a draft on the Draft tab first. Platform versions are built from your piece (the revision if you've made one, otherwise your original)." />;
  }

  const usingRevision = !!(piece.revision && piece.revision.text);

  return (
    <div className="scroll-y" style={{ flex: 1 }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 32px 90px" }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Platform Generation</div>
        <h2 style={{ fontSize: 30, marginBottom: 8 }}>Make it platform-native</h2>
        <p className="muted" style={{ fontSize: 16, marginBottom: 4 }}>
          Each post is an independent entry point, not an excerpt. Generated in a fixed order so each derives from the right source.
        </p>
        <p className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 22 }}>
          Source = {usingRevision ? "your Proposed Revision" : "your original draft"}.
        </p>

        {/* toggles */}
        <div className="card" style={{ padding: "8px 4px", marginBottom: 20 }}>
          {window.GEN.PLATFORMS.map((p, i) => {
            const on = active.includes(p.id);
            return (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: isMobile ? "32px 1fr" : "44px 1fr 220px", gap: isMobile ? "8px 12px" : 14, alignItems: "center",
                padding: "13px 18px", borderTop: i > 0 ? "1px solid var(--hair)" : "none" }}>
                <Toggle on={on} onChange={() => toggle(p.id)} />
                <div style={{ opacity: on ? 1 : 0.55 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{p.name}</span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{on ? derivationLabel(p.id, orderedActive) : p.register + " register"}</span>
                  </div>
                </div>
                <select className="field" value={auds[p.id]} disabled={!on}
                  onChange={(e) => setAuds((a) => ({ ...a, [p.id]: e.target.value }))}
                  style={{ fontSize: 13, padding: "7px 10px", opacity: on ? 1 : 0.4, gridColumn: isMobile ? "1 / -1" : "auto" }}>
                  {window.GEN.AUDIENCE_PRESETS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            );
          })}
        </div>

        {/* provenance */}
        <div className="card" style={{ padding: "18px 22px", marginBottom: 20 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Generation order</div>
          <ProvenanceMap activeIds={orderedActive} prog={prog} />
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 28 }}>
          <button className="btn primary" onClick={generate} disabled={busy || orderedActive.length === 0}>
            {busy ? <><Spinner size={15} /> Generating {Object.values(prog).filter((s) => s === "done").length}/{orderedActive.length}…</> : <><Icon name="play" size={15} /> Generate {orderedActive.length} version{orderedActive.length !== 1 ? "s" : ""}</>}
          </button>
          {err && <span style={{ color: "var(--sev-must)", fontSize: 14 }}>{err}</span>}
        </div>

        {/* results */}
        {(piece.outputOrder || []).length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <div className="eyebrow" style={{ marginRight: "auto" }}>{piece.outputOrder.length} output{piece.outputOrder.length !== 1 ? "s" : ""}</div>
            <button className="btn sm" onClick={() => downloadAllOutputs(piece)}><Icon name="doc" size={14} /> Download all (.zip)</button>
            <button className="btn sm" onClick={() => { if (!window.DRIVE.isConfigured()) { setDriveOpen(true); return; } driveSave(outputFiles(piece), setMsg); }}><GoogleIcon size={13} /> Save all to Drive</button>
            <button className="btn ghost sm" onClick={() => setDriveOpen(true)} title="Link / change Google Drive folder"><Icon name="gear" size={14} /> {window.DRIVE.isConfigured() ? "Drive linked" : "Link Drive"}</button>
          </div>
        )}
        {msg && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 16, borderRadius: "var(--radius)",
            background: msg.t === "err" ? "var(--sev-must-bg)" : msg.t === "ok" ? "oklch(0.56 0.10 150 / 0.12)" : "var(--paper-sunk)",
            color: msg.t === "err" ? "var(--sev-must)" : msg.t === "ok" ? "var(--st-approved)" : "var(--ink-2)", fontSize: 14 }}>
            {msg.t === "busy" && <Spinner size={14} />}
            {msg.t === "ok" && <Icon name="check" size={15} />}
            {msg.t === "err" && <Icon name="warn" size={15} />}
            <span>{msg.m}</span>
            {msg.link && <a href={msg.link} target="_blank" rel="noopener" style={{ marginLeft: 4 }}>Open in Drive →</a>}
            {(msg.t === "link") && <button className="btn ghost sm" onClick={() => setDriveOpen(true)} style={{ marginLeft: 4 }}>Link Drive</button>}
            <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setMsg(null)}>Dismiss</button>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {(piece.outputOrder || []).map((pid) => {
            const o = piece.outputs[pid]; if (!o) return null;
            return <OutputCard key={pid} o={o} derivation={derivationLabel(pid, piece.outputOrder)} pieceId={piece.id} platform={pid} onCondensed={onCondensed} onDrive={onDriveOne} onVideo={onVideo} onImage={onImage} />;
          })}
        </div>
        {driveOpen && <DriveDialog onClose={() => setDriveOpen(false)} />}
      </div>
    </div>
  );
}

Object.assign(window, { OutputsTab });
