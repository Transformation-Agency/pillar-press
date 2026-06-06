/* Revision tab — Proposed Revision, changelog, and an inline word-diff. */

function diffWords(a, b) {
  const A = (a || "").split(/(\s+)/), B = (b || "").split(/(\s+)/);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: "eq", s: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", s: A[i] }); i++; }
    else { out.push({ t: "ins", s: B[j] }); j++; }
  }
  while (i < n) { out.push({ t: "del", s: A[i++] }); }
  while (j < m) { out.push({ t: "ins", s: B[j++] }); }
  return out;
}

function DiffView({ original, revision }) {
  const parts = React.useMemo(() => diffWords(original, revision), [original, revision]);
  return (
    <div style={{ whiteSpace: "pre-wrap", fontSize: 17, lineHeight: 1.78 }}>
      {parts.map((p, i) => {
        if (p.t === "eq") return <span key={i}>{p.s}</span>;
        if (p.t === "del") return <del key={i} style={{ color: "var(--sev-must)", background: "var(--sev-must-bg)", textDecoration: "line-through", borderRadius: 2 }}>{p.s}</del>;
        return <ins key={i} style={{ color: "var(--st-approved)", background: "oklch(0.56 0.10 150 / 0.12)", textDecoration: "none", borderRadius: 2 }}>{p.s}</ins>;
      })}
    </div>
  );
}

function revisionToText(rev) {
  let out = rev.text + "\n\n— CHANGELOG —\n";
  (rev.changelog || []).forEach((c) => { out += `• ${c.change}  [${c.finding}]${c.note ? " — " + c.note : ""}\n`; });
  return out;
}

function RevisionTab({ piece, onUpdate, refCtx }) {
  const [busy, setBusy] = React.useState(false);
  const [prog, setProg] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [mode, setMode] = React.useState("clean"); // clean | diff
  const [full, setFull] = React.useState(false);   // full = restructure + polish
  const isMobile = window.useIsMobile();
  const rev = piece.revision;

  const generate = async () => {
    setBusy(true); setErr(null); setProg(null);
    try {
      const res = await window.GEN.generateRevision(piece, refCtx, (done, total) => {
        setProg({ done, total });
      }, { mode: full ? "full" : "light" });
      const revision = { text: res.revision, changelog: res.changelog };
      const patch = { revision };
      if (piece.status === "Reviewed") patch.status = "Revised";
      onUpdate(patch);
    } catch (e) { setErr(e.message || "Generation failed."); }
    setBusy(false); setProg(null);
  };

  const busyLabel = prog && prog.total > 1
    ? `Revising passage ${Math.min(prog.done + 1, prog.total)} of ${prog.total}…`
    : (full ? "Restructuring, then revising…" : "Writing the revision…");

  // Toggle: light firewall pass vs full restructure-then-polish pass.
  const FullToggle = (
    <label title="Full revision: restructure the piece (strategy, audience, rigor, structure) then polish (clarity, tone, inoculation). Off = the light clarity/tone/inoculation pass only."
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: full ? "var(--accent-ink)" : "var(--ink-3)", cursor: "pointer", userSelect: "none" }}>
      <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} disabled={busy} />
      Full revision — apply strategy &amp; structure too
    </label>
  );

  if (!piece.packet) {
    return <EmptyState icon="flag" title="Run the review first"
      body="The Proposed Revision is built from the Review Packet — it applies only the clarity, tone, and inoculation findings. Run the gates, then come back." />;
  }

  if (!rev) {
    return (
      <div className="scroll-y" style={{ flex: 1 }}>
        <div style={{ maxWidth: 620, margin: "70px auto", textAlign: "center", padding: "0 32px" }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Proposed Revision</div>
          <h2 style={{ fontSize: 30, marginBottom: 14 }}>Build the proposed revision</h2>
          <p className="muted" style={{ fontSize: 16.5, marginBottom: 8 }}>
            A full rewrite that keeps your structure and register and applies <em>only</em> the
            clarity, tone, and inoculation findings. Strategy, audience, rigor, and identity
            findings stay in the report for you to judge.
          </p>
          <p className="muted" style={{ fontSize: 14.5, fontStyle: "italic", marginBottom: 24 }}>
            Where a clarity rule would flatten a line that sounds like you, your line wins.
          </p>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>{FullToggle}</div>
          <button className="btn primary" onClick={generate} disabled={busy}>
            {busy ? <><Spinner size={15} /> {busyLabel}</> : <><Icon name="play" size={15} /> Generate revision</>}
          </button>
          {err && <p style={{ color: "var(--sev-must)", marginTop: 16, fontSize: 14 }}>{err}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="scroll-y" style={{ flex: 1 }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: isMobile ? "20px 16px 80px" : "26px 32px 90px",
        display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 320px", gap: isMobile ? 18 : 36, alignItems: "start" }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 4, background: "var(--paper-sunk)", borderRadius: 999, padding: 3 }}>
              {[["clean", "Clean"], ["diff", "Show changes"]].map(([id, l]) => (
                <button key={id} onClick={() => setMode(id)} className="mono"
                  style={{ fontSize: 11.5, padding: "6px 14px", borderRadius: 999, border: "none", cursor: "pointer",
                    background: mode === id ? "var(--paper-2)" : "transparent", color: mode === id ? "var(--ink)" : "var(--ink-3)",
                    boxShadow: mode === id ? "var(--shadow-sm)" : "none" }}>{l}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {FullToggle}
              <CopyButton text={() => rev.text} label="Copy revision" />
              <button className="btn ghost sm" onClick={generate} disabled={busy}>
                {busy ? <Spinner size={14} /> : <Icon name="play" size={14} />} Regenerate
              </button>
            </div>
          </div>
          <div className="card" style={{ padding: "34px 40px" }}>
            {mode === "clean"
              ? <div style={{ whiteSpace: "pre-wrap", fontSize: 17.5, lineHeight: 1.78 }}>{rev.text}</div>
              : <DiffView original={piece.original} revision={rev.text} />}
          </div>
          {mode === "diff" && (
            <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12 }} className="mono">
              <span><del style={{ color: "var(--sev-must)" }}>removed</del></span>
              <span><ins style={{ color: "var(--st-approved)", textDecoration: "none" }}>added</ins></span>
            </div>
          )}
        </div>

        {/* changelog */}
        <div className="card" style={{ padding: "20px 22px", position: "sticky", top: 24 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Changelog</div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Each change traces to its finding; <span style={{ color: "var(--st-approved)" }}>✎ author-directed</span> lines came from your direction or commentary.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {(rev.changelog || []).length === 0 && <span className="muted" style={{ fontSize: 14, fontStyle: "italic" }}>No changes were needed.</span>}
            {(rev.changelog || []).map((c, i) => {
              const dir = String(c.finding || "").toUpperCase() === "DIR";
              return (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingBottom: 12, borderBottom: i < rev.changelog.length - 1 ? "1px solid var(--hair)" : "none" }}>
                  <span className="mono" title={dir ? "Driven by your direction / commentary" : "Traces to finding " + c.finding}
                    style={{
                      fontSize: 10, padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap", flexShrink: 0, marginTop: 2,
                      background: dir ? "var(--st-approved-bg, transparent)" : "var(--accent-soft)",
                      color: dir ? "var(--st-approved)" : "var(--accent-ink)",
                      border: "1px solid " + (dir ? "var(--st-approved)" : "transparent"),
                    }}>{dir ? "✎ Author-directed" : c.finding}</span>
                  <div>
                    <div style={{ fontSize: 14, lineHeight: 1.45 }}>{c.change}</div>
                    {c.note && <div className="muted" style={{ fontSize: 12.5, fontStyle: "italic", marginTop: 2 }}>{c.note}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, body, action }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 40 }}>
      <div style={{ textAlign: "center", maxWidth: 460 }}>
        <div style={{ width: 52, height: 52, borderRadius: 999, border: "1px solid var(--hair-2)", display: "grid", placeItems: "center", margin: "0 auto 18px", color: "var(--ink-3)" }}>
          <Icon name={icon} size={22} />
        </div>
        <h2 style={{ fontSize: 24, marginBottom: 10 }}>{title}</h2>
        <p className="muted" style={{ fontSize: 16 }}>{body}</p>
        {action}
      </div>
    </div>
  );
}

Object.assign(window, { RevisionTab, EmptyState, diffWords, revisionToText });
