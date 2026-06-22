/* Library — home. List of pieces with status, filter, new piece. */

function wordCount(t) { return (t || "").trim() ? (t.trim().split(/\s+/).length) : 0; }

function PieceRow({ piece, campaignLabel, onOpen, onDelete }) {
  const [hover, setHover] = React.useState(false);
  const [titling, setTitling] = React.useState(false);
  const autoTitle = async (e) => {
    e.stopPropagation();
    setTitling(true);
    try {
      const r = await fetch("/api/pieces/" + piece.id + "/title", { method: "POST", headers: { Accept: "application/json" }, credentials: "same-origin" });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && d.error) || "Couldn't auto-title.");
      if (d && d.title) window.Store.updatePiece(piece.id, { title: d.title });
    } catch (err) { window.alert((err && err.message) || "Couldn't auto-title."); }
    setTitling(false);
  };
  const snippet = (piece.original || "").trim().split("\n").find((l) => l.trim()) || "No draft yet — paste one to begin.";
  const hasPacket = !!piece.packet;
  const hasRev = !!piece.revision;
  const nOut = (piece.outputOrder || []).length;
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(piece.id)}
      style={{
        display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "center",
        padding: "22px 24px", borderBottom: "1px solid var(--hair)", cursor: "pointer",
        background: hover ? "var(--paper-2)" : "transparent", transition: "background 0.15s",
        marginInline: hover ? -1 : 0, borderRadius: hover ? "var(--radius)" : 0,
        boxShadow: hover ? "var(--shadow-sm)" : "none",
      }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 5 }}>
          <h3 style={{ fontSize: 22, letterSpacing: "-0.01em" }}>{piece.title}</h3>
          {campaignLabel && <span className="eyebrow" style={{ color: "var(--ink-3)" }}>{campaignLabel}</span>}
        </div>
        <p className="muted" style={{
          margin: 0, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          maxWidth: "62ch", fontStyle: piece.original ? "normal" : "italic",
        }}>{snippet}</p>
        <div style={{ display: "flex", gap: 14, marginTop: 10, alignItems: "center" }}>
          <span className="eyebrow">{wordCount(piece.original)} words</span>
          <span className="eyebrow">· edited {window.relTime(piece.updatedAt)}</span>
          <div style={{ display: "flex", gap: 7, marginLeft: 4 }}>
            <ProgressPip on={hasPacket} label="Reviewed" />
            <ProgressPip on={hasRev} label="Revised" />
            <ProgressPip on={nOut > 0} label={nOut ? `${nOut} outputs` : "Outputs"} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <StatusChip status={piece.status} />
        <button className="icon-btn" title="Auto-title from the draft" onClick={autoTitle} disabled={titling}
          style={{ opacity: hover ? 1 : 0.55, transition: "opacity 0.15s" }}>
          {titling ? <Spinner size={14} /> : <Icon name="sparkle" size={15} />}
        </button>
        <button className="icon-btn" title="Delete piece"
          onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${piece.title}"? This can't be undone.`)) onDelete(piece.id); }}
          style={{ opacity: hover ? 1 : 0.55, transition: "opacity 0.15s" }}>
          <Icon name="trash" size={15} />
        </button>
        <Icon name="chevR" size={18} style={{ color: "var(--ink-3)" }} />
      </div>
    </div>
  );
}

function ProgressPip({ on, label }) {
  return (
    <span className="mono" style={{
      fontSize: 10, letterSpacing: "0.04em", padding: "1px 7px", borderRadius: 999,
      border: "1px solid " + (on ? "var(--accent)" : "var(--hair)"),
      color: on ? "var(--accent-ink)" : "var(--ink-3)",
      background: on ? "var(--accent-soft)" : "transparent",
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      {on && <span style={{ width: 5, height: 5, borderRadius: 99, background: "var(--accent)" }} />}
      {label}
    </span>
  );
}

function Library({ pieces, campaignName, campaigns, allPieces, activeCampaignId, onOpen, onNew, onDelete, onOpenWeave, onOpenStudio, onSwitchCampaign }) {
  const [filter, setFilter] = React.useState("All");
  const [scope, setScope] = React.useState("all");
  React.useEffect(() => {
    if (window.Store && window.Store.hydrateLibraryPieces) {
      window.Store.hydrateLibraryPieces().catch(() => null);
    }
  }, []);
  const filters = ["All", ...window.Store.STATUSES];
  const campaignNames = {};
  (campaigns || []).forEach((c) => { if (c && c.id) campaignNames[c.id] = c.name; });
  const scopedPieces = scope === "all" ? (allPieces || []) : pieces;
  const counts = {};
  window.Store.STATUSES.forEach((s) => { counts[s] = scopedPieces.filter((p) => p.status === s).length; });
  const shown = (filter === "All" ? scopedPieces : scopedPieces.filter((p) => p.status === filter))
    .slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const campaignsWithPieces = window.LIBRARY.campaignsWithRestoredPieces(campaigns, allPieces, activeCampaignId, 4);
  const openPiece = (piece) => {
    if (piece && piece.campaignId && piece.campaignId !== activeCampaignId && onSwitchCampaign) {
      onSwitchCampaign(piece.campaignId);
    }
    onOpen(piece.id);
  };

  return (
    <div className="scroll-y" style={{ flex: 1 }}>
      <div style={{ maxWidth: 940, margin: "0 auto", padding: "46px 32px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{campaignName ? campaignName + " · campaign" : "The Desk"}</div>
            <h1 style={{ fontSize: 42, letterSpacing: "-0.02em" }}>Library</h1>
          </div>
          <button className="btn primary" onClick={onNew}>
            <Icon name="plus" size={16} /> New piece
          </button>
        </div>
        <p className="muted" style={{ fontSize: 17, marginTop: 14, maxWidth: "54ch" }}>
          Every piece you've brought to the desk. You set the status by hand as it moves
          from draft to formatted.
        </p>

        <div style={{ display: "inline-flex", gap: 4, padding: 4, border: "1px solid var(--hair)", borderRadius: 999, background: "var(--paper-2)", marginTop: 18 }}>
          {[
            ["active", "This focus"],
            ["all", "All focuses"],
          ].map(([id, label]) => (
            <button
              key={id}
              className="mono"
              onClick={() => setScope(id)}
              style={{
                border: "none", borderRadius: 999, padding: "7px 12px", cursor: "pointer",
                background: scope === id ? "var(--ink)" : "transparent",
                color: scope === id ? "var(--paper)" : "var(--ink-2)",
                fontSize: 11.5,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {campaignsWithPieces.length > 0 && (
          <div style={{ margin: "22px 0 4px" }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Documents in other focuses</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
              {campaignsWithPieces.map(({ campaign, count }) => (
                <button
                  key={campaign.id}
                  className="btn ghost"
                  onClick={() => onSwitchCampaign && onSwitchCampaign(campaign.id)}
                  style={{ justifyContent: "space-between", border: "1px solid var(--hair)", background: "var(--paper-2)", padding: "11px 13px" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Icon name="book" size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{campaign.name}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", flex: "0 0 auto" }}>
                    {count} {count === 1 ? "piece" : "pieces"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, margin: "24px 0 6px" }}>
          <button className="btn ghost" onClick={onOpenWeave} style={{ justifyContent: "space-between", padding: "13px 14px", border: "1px solid var(--hair)", background: "var(--paper-2)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icon name="sparkle" size={14} /> Weave sources
            </span>
            <Icon name="arrowR" size={14} />
          </button>
          <button className="btn ghost" onClick={onOpenStudio} style={{ justifyContent: "space-between", padding: "13px 14px", border: "1px solid var(--hair)", background: "var(--paper-2)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icon name="image" size={14} /> Studio media
            </span>
            <Icon name="arrowR" size={14} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, margin: "28px 0 8px", flexWrap: "wrap" }}>
          {filters.map((f) => {
            const on = f === filter;
            const c = f === "All" ? scopedPieces.length : counts[f];
            return (
              <button key={f} onClick={() => setFilter(f)}
                className="mono"
                style={{
                  fontSize: 12, letterSpacing: "0.04em", padding: "7px 13px", borderRadius: 999,
                  border: "1px solid " + (on ? "var(--ink)" : "var(--hair)"),
                  background: on ? "var(--ink)" : "transparent",
                  color: on ? "var(--paper)" : "var(--ink-2)", cursor: "pointer", transition: "all 0.15s",
                }}>
                {f} <span style={{ opacity: 0.6 }}>{c}</span>
              </button>
            );
          })}
        </div>

        <div className="card" style={{ marginTop: 18, overflow: "hidden" }}>
          {shown.length === 0 ? (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <p className="muted" style={{ fontStyle: "italic" }}>
                {scopedPieces.length ? "No pieces match this filter." : (scope === "all" ? "No pieces yet." : "Nothing in this campaign yet.")}
              </p>
              <button className="btn" onClick={onNew} style={{ marginTop: 8 }}>
                <Icon name="plus" size={15} /> Start a piece
              </button>
            </div>
          ) : shown.map((p) => (
            <PieceRow
              key={p.id}
              piece={p}
              campaignLabel={scope === "all" && p.campaignId !== activeCampaignId ? campaignNames[p.campaignId] : null}
              onOpen={() => openPiece(p)}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Library, wordCount });
