/* ============================================================
   Book Writer — a thin workflow UI over the existing engine.
   Campaign = book · Piece = chapter. Orchestrates the SAME
   server routes used everywhere else (review / revision /
   outputs / weave / export) — no prompts, no AI, no schemas
   are redefined here. Ported from the frontend-dev handoff
   (prototype-reference/screen-book.jsx), with three production
   adaptations to this app's server-orchestrated backend:
     · Review calls POST /api/pieces/:id/review (the canonical
       route that persists the packet) instead of the legacy
       client-side per-gate loop.
     · Download / Drive use GET /api/campaigns/:id/book/export
       (the AI-free server assembler) as the single source of
       the manuscript markdown.
     · Chapter text is saved (awaited) before any AI pass so the
       server reads the latest draft.
   Three panes: Chapters | Chapter editor | Workflow sidebar.
   ============================================================ */

/* ---- small fetch wrapper: JSON, same-origin creds, throws on !ok ---- */
async function bookApi(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: Object.assign({ Accept: "application/json" }, body != null ? { "Content-Type": "application/json" } : {}),
    credentials: "same-origin",
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  let data = null; try { data = await r.json(); } catch (e) { /* non-JSON */ }
  if (!r.ok) {
    const msg = (data && data.error) ||
      (r.status === 401 ? "You're signed out — please sign in again."
        : r.status === 403 ? "You don't have permission to do that."
        : r.status === 404 ? "Not found."
        : "Request failed (" + r.status + ").");
    throw new Error(msg);
  }
  return data;
}
/* tolerate raw objects or { piece } / { data } / { result } wrappers */
function bookUnwrap(res, key) {
  if (!res) return null;
  if (res[key] != null) return res[key];
  if (res.piece && res.piece[key] != null) return res.piece[key];
  if (res.data && res.data[key] != null) return res.data[key];
  if (res.result && res.result[key] != null) return res.result[key];
  return null;
}

/* ---- chapter ordering: leading number, else "Chapter N", else created ---- */
function chapterNum(title) {
  const t = String(title || "");
  const lead = t.match(/^\s*0*(\d{1,3})\b/);
  if (lead) return parseInt(lead[1], 10);
  const ch = t.match(/\b(?:chapter|ch\.?|part)\s+0*(\d{1,3})\b/i);
  if (ch) return parseInt(ch[1], 10);
  return null;
}
function sortChapters(pieces) {
  return (pieces || []).slice().sort((a, b) => {
    const na = chapterNum(a.title), nb = chapterNum(b.title);
    if (na != null && nb != null) return na - nb || (a.createdAt || 0) - (b.createdAt || 0);
    if (na != null) return -1;
    if (nb != null) return 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}
function chapterText(p) {
  return (p && p.original && p.original.trim()) ? p.original : ((p && p.revision && p.revision.text) || "");
}
function wc(t) { return (t || "").trim() ? t.trim().split(/\s+/).length : 0; }

/* Split a Source Pack textarea into weave sources (weave needs >= 2). */
function notesToSources(notes) {
  const raw = String(notes || "").trim();
  if (!raw) return [];
  let chunks = raw.split(/\n\s*\n\s*\n+/).map((s) => s.trim()).filter(Boolean);   // hard breaks
  if (chunks.length < 2) chunks = raw.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean); // paragraphs
  return chunks.map((c, i) => {
    const first = c.split("\n")[0].replace(/^#+\s*/, "").trim();
    const name = first.length > 2 && first.length < 70 ? first : "Source " + (i + 1);
    return { name, text: c };
  });
}

const BOOK_PLAT_AUD = { substack: "builders", facebook: "relational", instagram: "women-ai", x: "builders", threads: "general" };

/* ---------- book selector: a book IS a campaign (its own library) ---------- */
function BookPicker({ campaigns, bookId, onPick, onNew, role }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const active = (campaigns || []).find((c) => c.id === bookId);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Book</div>
      <button onClick={() => setOpen((o) => !o)} title="Switch book"
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", cursor: "pointer",
          border: "1px solid var(--hair-2)", background: "var(--paper-2)", color: "var(--ink)",
          borderRadius: "var(--radius)", padding: "8px 10px", textAlign: "left" }}>
        <Icon name="book" size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 15, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active ? active.name : "Choose a book…"}</span>
        <Icon name="chevD" size={13} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", top: 64, left: 0, right: 0, padding: 6, zIndex: 60, boxShadow: "var(--shadow-lg)", maxHeight: "60vh", overflowY: "auto" }}>
          <div className="eyebrow" style={{ padding: "6px 10px 4px" }}>Each book is its own campaign</div>
          {(campaigns || []).map((c) => {
            const on = c.id === bookId;
            return (
              <button key={c.id} onClick={() => { onPick(c.id); setOpen(false); }}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  border: "none", background: on ? "var(--accent-soft)" : "transparent", cursor: "pointer",
                  borderRadius: "var(--radius)", padding: "9px 10px", color: on ? "var(--accent-ink)" : "var(--ink)",
                  fontFamily: "var(--font-body)", fontSize: 15, textAlign: "left" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9, overflow: "hidden" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: on ? "var(--accent)" : "var(--hair-2)", flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                </span>
                {on && <Icon name="check" size={15} />}
              </button>
            );
          })}
          {role !== "assistant" && (
            <>
              <hr className="rule" style={{ margin: "5px 4px" }} />
              <button onClick={() => { onNew(); setOpen(false); }} className="mono"
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, border: "none", background: "transparent", cursor: "pointer", borderRadius: "var(--radius)", padding: "9px 10px", color: "var(--ink-3)", fontSize: 12, letterSpacing: "0.04em" }}>
                <Icon name="plus" size={13} /> NEW BOOK
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- left: chapter list ---------- */
function ChapterList({ chapters, selectedId, onSelect, onAdd, role, campaigns, bookId, onPickBook, onNewBook, isMobile, hidden }) {
  const [adding, setAdding] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const commit = () => {
    const n = chapters.length + 1;
    onAdd(title.trim() || ("Chapter " + n));
    setTitle(""); setAdding(false);
  };
  return (
    <div style={{ width: isMobile ? "100%" : 248, flex: isMobile ? 1 : "none", flexShrink: 0,
      borderRight: isMobile ? "none" : "1px solid var(--hair)",
      display: hidden ? "none" : "flex", flexDirection: "column", minHeight: 0, background: "var(--paper)" }}>
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--hair)" }}>
        <BookPicker campaigns={campaigns} bookId={bookId} onPick={onPickBook} onNew={onNewBook} role={role} />
        <div className="muted mono" style={{ fontSize: 11, marginTop: 8 }}>{chapters.length} chapter{chapters.length !== 1 ? "s" : ""}</div>
      </div>
      <div className="scroll-y" style={{ flex: 1, padding: "0 10px" }}>
        {chapters.map((c, i) => {
          const on = c.id === selectedId;
          return (
            <button key={c.id} onClick={() => onSelect(c.id)}
              style={{ display: "block", width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                background: on ? "var(--accent-soft)" : "transparent", borderRadius: "var(--radius)",
                padding: "11px 12px", marginBottom: 2, transition: "background 0.12s" }}>
              <div style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
                <span className="mono" style={{ fontSize: 11, color: on ? "var(--accent-ink)" : "var(--ink-3)", flexShrink: 0, width: 18 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 16, lineHeight: 1.25, color: on ? "var(--ink)" : "var(--ink-2)", flex: 1 }}>{c.title || "Untitled"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, paddingLeft: 27 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: `var(${window.STATUS_VAR[c.status] || "--st-draft"})` }} />
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{c.status}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>· {wc(chapterText(c))}w</span>
                {c.packet && <span title="reviewed" style={{ width: 5, height: 5, borderRadius: 99, background: "var(--accent)" }} />}
              </div>
            </button>
          );
        })}
        {chapters.length === 0 && <p className="muted" style={{ fontSize: 13, padding: "8px 12px", fontStyle: "italic" }}>No chapters yet.</p>}
      </div>
      {role !== "assistant" && bookId && (
        <div style={{ padding: 12, borderTop: "1px solid var(--hair)" }}>
          {adding ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setAdding(false); }}
                placeholder={"Chapter " + (chapters.length + 1) + " title…"} style={{ fontSize: 14 }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn primary sm" onClick={commit} style={{ flex: 1 }}>Add</button>
                <button className="btn ghost sm" onClick={() => { setAdding(false); setTitle(""); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn sm" onClick={() => setAdding(true)} style={{ width: "100%" }}><Icon name="plus" size={14} /> Add chapter</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- right: compact packet / revision / outputs renderers ---------- */
function PacketView({ piece }) {
  if (!piece.packet) return <Hint icon="flag" text="Run Review to generate the seven-gate Review Packet for this chapter." />;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <CopyButton text={() => window.packetToText(piece)} label="Copy packet" />
      </div>
      {window.GATES.map((g) => {
        const r = piece.packet[g.id]; if (!r) return null;
        return (
          <div key={g.id} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid var(--hair)" }}>
            <h4 style={{ fontSize: 16 }}><span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginRight: 7 }}>{String(g.n).padStart(2, "0")}</span>{g.name}</h4>
            {r.summary && <p className="muted" style={{ fontSize: 13.5, margin: "6px 0 8px" }}>{r.summary}</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {(r.findings || []).map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ marginTop: 2 }}><SeverityTag sev={f.severity} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</div>
                    <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{f.detail}</div>
                  </div>
                </div>
              ))}
              {(r.findings || []).length === 0 && <span className="muted" style={{ fontSize: 13, fontStyle: "italic" }}>Clear.</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RevisionView({ piece, onAccept, accepting }) {
  const rev = piece.revision;
  if (!rev) return <Hint icon="play" text="Run Revise to generate a Proposed Revision. It applies only clarity, tone & inoculation findings — your line wins." />;
  const accepted = (piece.original || "").trim() === (rev.text || "").trim();
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        {accepted
          ? <span className="chip" style={{ color: "var(--st-approved)", borderColor: "var(--st-approved)" }}><span className="dot" /> Accepted into draft</span>
          : <button className="btn primary sm" onClick={onAccept} disabled={accepting}>{accepting ? <Spinner size={13} /> : <Icon name="check" size={13} />} Accept revision</button>}
        <CopyButton text={() => rev.text} label="Copy" />
      </div>
      <div className="card" style={{ padding: "16px 18px", background: "var(--paper-sunk)", whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.7, marginBottom: 16 }}>{rev.text}</div>
      {(rev.changelog || []).length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Changelog</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {rev.changelog.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <span className="mono" style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--accent-soft)", color: "var(--accent-ink)", flexShrink: 0, marginTop: 1 }}>{c.finding}</span>
                <div><div style={{ fontSize: 13.5 }}>{c.change}</div>{c.note && <div className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>{c.note}</div>}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OutputsView({ piece }) {
  if (!(piece.outputOrder || []).length) return <Hint icon="arrowR" text="Run Generate Outputs for platform-native versions (Substack → Facebook → Instagram → X → Threads)." />;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <CopyButton text={() => window.EXPORT.pieceOutputsMarkdown(piece)} label="Copy all" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {piece.outputOrder.map((pid) => {
          const o = piece.outputs[pid]; if (!o) return null;
          const clear = /clear|none|no concern|pass/i.test(o.riskCheck || "");
          return (
            <div key={pid} className="card" style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h4 style={{ fontSize: 17 }}>{o.platform}</h4>
                <CopyButton text={() => window.EXPORT.outputMarkdown(o)} label="" />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <span className="chip">{o.selectedAudience}</span>
                <span className="chip" style={{ color: "var(--accent-ink)", borderColor: "var(--accent)" }}>#{o.throughlineTag}</span>
              </div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.6, padding: "12px 14px", background: "var(--paper-sunk)", borderRadius: "var(--radius)", marginBottom: 12 }}>{o.draftPost}</div>
              <MiniField label="Hooks" items={o.hooks} />
              <MiniField label="CTAs" items={o.ctas} />
              <div style={{ display: "flex", flexDirection: "column", gap: 5, borderTop: "1px solid var(--hair)", paddingTop: 10, marginTop: 6 }}>
                <MiniLine label="Media" value={o.mediaRec} />
                <MiniLine label="Related" value={o.relatedOffering} />
                <MiniLine label="Follow-up" value={o.followUp} />
                <div style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13 }}>
                  <span className="eyebrow" style={{ minWidth: 70 }}>Risk</span>
                  <span style={{ color: clear ? "var(--st-approved)" : "var(--sev-must)", display: "flex", gap: 5, alignItems: "center" }}><Icon name={clear ? "check" : "warn"} size={13} />{o.riskCheck}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function MiniField({ label, items }) {
  if (!(items || []).length) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="eyebrow" style={{ marginBottom: 3 }}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13.5, lineHeight: 1.5 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}
function MiniLine({ label, value }) {
  return <div style={{ display: "flex", gap: 7, fontSize: 13 }}><span className="eyebrow" style={{ minWidth: 70 }}>{label}</span><span style={{ flex: 1 }}>{value}</span></div>;
}

function Hint({ icon, text }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 18px", color: "var(--ink-3)" }}>
      <div style={{ width: 40, height: 40, borderRadius: 999, border: "1px solid var(--hair-2)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}><Icon name={icon} size={17} /></div>
      <p style={{ fontSize: 13.5, margin: 0, maxWidth: "34ch", marginInline: "auto", lineHeight: 1.5 }}>{text}</p>
    </div>
  );
}

/* ---------- right: Source Pack (weave) ---------- */
function SourcePack({ piece, refCtx, onDraft, busy, setBusy, setErr }) {
  const [notes, setNotes] = React.useState("");
  const [prog, setProg] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef(null);
  const weave = piece.weave;

  const upload = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    setUploading(true); setErr(null);
    for (const f of files) {
      try {
        const text = await window.extractFileText(f);
        setNotes((prev) => (prev.trim() ? prev.trim() + "\n\n" : "") + text);
      } catch (err) { setErr((err && err.message) || ("Couldn't read " + f.name + ".")); }
    }
    setUploading(false);
  };

  const run = async () => {
    const sources = notesToSources(notes);
    setBusy("weave"); setErr(null); setProg(null);
    try {
      const res = await window.WEAVE.runWeave(sources, refCtx, (p) => setProg(p));
      window.Store.updatePiece(piece.id, { weave: res, original: res.draft, status: piece.status === "Draft" ? "Draft" : piece.status });
      onDraft(res.draft);
    } catch (e) { setErr(e.message || "Weave failed."); }
    setBusy(null); setProg(null);
  };

  const progLabel = prog
    ? (prog.phase === "extract" ? `Reading source ${prog.i + 1}/${prog.total}…`
      : prog.phase === "brief" ? "Finding the emergent thread…"
      : prog.phase === "map" ? "Mapping to your references…"
      : prog.phase === "draft" ? `Drafting section ${prog.i + 1}/${prog.total}…` : "Weaving…")
    : "";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
          Paste or upload research, notes, excerpts, or an outline. Separate distinct sources with a blank line — weave finds the thread and drafts the chapter.
        </p>
        <input ref={fileRef} type="file" accept={window.UPLOAD_ACCEPT} multiple style={{ display: "none" }} onChange={upload} />
        <button className="btn ghost sm" style={{ flexShrink: 0 }} disabled={busy === "weave" || uploading} onClick={() => fileRef.current.click()} title="Upload PDFs, images, .docx, or text files">
          {uploading ? <Spinner size={13} /> : <Icon name="doc" size={13} />} Upload
        </button>
      </div>
      <textarea className="field" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy === "weave"}
        placeholder={"Paste source material here…\n\nA second source, separated by a blank line…"}
        style={{ minHeight: 200, fontSize: 14, lineHeight: 1.6, resize: "vertical", background: "var(--paper-2)" }} />
      <button className="btn primary" onClick={run} disabled={!!busy || notes.trim().length < 20} style={{ width: "100%", marginTop: 10 }}>
        {busy === "weave" ? <><Spinner size={14} /> {progLabel}</> : <><Icon name="play" size={14} /> Weave into chapter draft</>}
      </button>

      {weave && weave.brief && (
        <div style={{ marginTop: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Last weave</div>
          <div className="card" style={{ padding: "14px 16px", background: "var(--paper-sunk)" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, marginBottom: 4 }}>{weave.brief.workingTitle}</div>
            <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>{weave.brief.concept}</p>
            {(weave.mapping && weave.mapping.mapped || []).length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
                {weave.mapping.mapped.map((m, i) => <span key={i} className="chip" style={{ color: "var(--accent-ink)", borderColor: "var(--accent)" }}>#{m.tag}</span>)}
              </div>
            )}
            <Collapsible label={`Source extracts (${(weave.extracts || []).length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {(weave.extracts || []).map((e, i) => (
                  <div key={i} style={{ fontSize: 12.5 }}>
                    <strong>{e.name}</strong>
                    <div className="muted">{e.summary}</div>
                  </div>
                ))}
              </div>
            </Collapsible>
          </div>
        </div>
      )}
    </div>
  );
}

function Collapsible({ label, children }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn ghost sm" onClick={() => setOpen(!open)} style={{ padding: "3px 0", color: "var(--ink-2)" }}>
        <Icon name={open ? "chevD" : "chevR"} size={13} /> {label}
      </button>
      {open && children}
    </div>
  );
}

/* ---------- main ---------- */
function BookWriter({ campaigns, allPieces, role, onOpenPiece, onActivateCampaign }) {
  // A book IS a campaign, chosen here independently of the globally-active
  // campaign so a book has its own library separate from "Me". Remembered in prefs.
  const isMobile = window.useIsMobile();
  const [mobilePane, setMobilePane] = React.useState("editor"); // mobile: chapters | editor | workflow
  const [bookId, setBookId] = React.useState(() => window.Store.getPref("bookCampaignId", null));
  const [selectedId, setSelectedId] = React.useState(null);
  const [panel, setPanel] = React.useState("sources");
  const [busy, setBusy] = React.useState(null);          // 'review'|'revise'|'outputs'|'weave'|'export'
  const [prog, setProg] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [note, setNote] = React.useState(null);          // transient success note
  const [title, setTitle] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [fullRevise, setFullRevise] = React.useState(false); // full = restructure + polish
  const [uploadingDraft, setUploadingDraft] = React.useState(false);
  const draftFileRef = React.useRef(null);

  // Drop a stale book selection if the campaign no longer exists; load the
  // book's pieces/references on demand (without making it the active campaign).
  React.useEffect(() => {
    if (bookId && !(campaigns || []).find((c) => c.id === bookId)) { setBookId(null); return; }
    if (bookId) window.Store.loadCampaign(bookId);
  }, [bookId, (campaigns || []).map((c) => c.id).join(",")]);

  const bookCampaign = (campaigns || []).find((c) => c.id === bookId) || null;
  const refs = (bookCampaign && bookCampaign.references) || {};
  const refCtx = window.AI.refContext(refs);
  const pieces = bookId ? (allPieces || []).filter((p) => p.campaignId === bookId) : [];
  const chapters = React.useMemo(() => sortChapters(pieces), [pieces]);

  const piece = selectedId ? window.Store.getPiece(selectedId) : null;

  const pickBook = (id) => { setBookId(id); window.Store.setPref("bookCampaignId", id); setSelectedId(null); setErr(null); setNote(null); };
  const newBook = () => {
    const n = window.prompt("Name your book");
    if (!n || !n.trim()) return;
    const id = window.Store.addCampaign(n.trim(), { activate: false }); // don't hijack the active campaign
    window.Store.loadCampaign(id);
    pickBook(id);
  };

  // keep a valid selection as chapters change
  React.useEffect(() => {
    if (!chapters.length) { setSelectedId(null); return; }
    if (!selectedId || !chapters.find((c) => c.id === selectedId)) setSelectedId(chapters[0].id);
  }, [chapters.map((c) => c.id).join(",")]);

  // load editor from the selected piece (only when selection changes) — never
  // clobber in-progress edits when an async result (packet/revision/outputs) returns
  React.useEffect(() => {
    const p = selectedId ? window.Store.getPiece(selectedId) : null;
    setTitle(p ? p.title : ""); setDraft(p ? (p.original || "") : "");
    setErr(null); setNote(null);
  }, [selectedId]);

  const dirty = piece && (title !== piece.title || draft !== (piece.original || ""));
  const saveNow = () => { if (piece && dirty) window.Store.updatePiece(piece.id, { title: title.trim() || piece.title, original: draft }); };

  // Awaited save so server-side AI passes (review/revision/outputs) and the
  // export route read the latest draft. Updates the cache optimistically too.
  const persistChapter = async () => {
    const p = window.Store.getPiece(selectedId); if (!p) return;
    const fields = { title: title.trim() || p.title, original: draft };
    window.Store.updatePiece(p.id, fields);
    await bookApi("PATCH", "/api/pieces/" + p.id, fields);
  };

  const flash = (m) => { setNote(m); setTimeout(() => setNote(null), 2200); };

  const selectChapter = (id) => { saveNow(); setSelectedId(id); setMobilePane("editor"); };
  const addChapter = (t) => { if (!bookId) return; const p = window.Store.createPiece(t, bookId); setSelectedId(p.id); setPanel("sources"); setMobilePane("editor"); };

  // Load a chapter draft from an uploaded file (PDF, image, .docx, or text).
  const uploadDraft = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || !piece) return;
    setUploadingDraft(true); setErr(null);
    try {
      const text = await window.extractFileText(f);
      const merged = draft.trim() ? draft.trimEnd() + "\n\n" + text : text;
      setDraft(merged);
      window.Store.updatePiece(piece.id, { original: merged });
    } catch (err) { setErr((err && err.message) || ("Couldn't read " + f.name + ".")); }
    setUploadingDraft(false);
  };

  const runReview = async () => {
    if (!selectedId || !(draft || "").trim()) { setErr("Add some chapter text first."); return; }
    setBusy("review"); setErr(null); setPanel("review"); setProg({ label: "Saving…" });
    let polling = true;
    try {
      await persistChapter();
      // poll /review/status for gate-by-gate progress while the server runs the 7 gates
      const poll = async () => {
        while (polling) {
          await new Promise((r) => setTimeout(r, 900));
          if (!polling) break;
          try {
            const r = await fetch("/api/pieces/" + selectedId + "/review/status", { headers: { Accept: "application/json" } });
            if (!r.ok) continue;
            const st = await r.json();
            const done = (st.completed || []).length;
            setProg({ label: "Reviewing · gate " + Math.min(done + 1, window.GATES.length) + "/" + window.GATES.length });
            if (st.done) break;
          } catch (e) { /* transient */ }
        }
      };
      const pollP = poll();
      const res = await bookApi("POST", "/api/pieces/" + selectedId + "/review");
      polling = false; await pollP;
      const packet = bookUnwrap(res, "packet");
      const status = (res && res.status) || (res && res.piece && res.piece.status) || "Reviewed";
      window.Store.updatePiece(selectedId, { packet, status });
      flash("Review packet ready");
    } catch (e) { polling = false; setErr(e.message || "Review failed."); }
    setBusy(null); setProg(null);
  };

  const runRevise = async () => {
    const p = window.Store.getPiece(selectedId);
    if (!p) return;
    if (!p.packet) { setErr("Run Review before Revise."); setPanel("review"); return; }
    setBusy("revise"); setErr(null); setPanel("revision");
    setProg({ label: fullRevise ? "Restructuring, then revising…" : "Writing the revision…" });
    try {
      await persistChapter();
      const res = await window.GEN.generateRevision(window.Store.getPiece(selectedId), refCtx,
        (done, total) => setProg({ label: `Revising passage ${done}/${total}…` }),
        { mode: fullRevise ? "full" : "light" });
      const patch = { revision: { text: res.revision, changelog: res.changelog } };
      if (p.status === "Reviewed") patch.status = "Revised";
      window.Store.updatePiece(p.id, patch);
      flash("Proposed revision ready");
    } catch (e) { setErr(e.message || "Revision failed."); }
    setBusy(null); setProg(null);
  };

  const runOutputs = async () => {
    if (!selectedId || !(draft || "").trim()) { setErr("Add chapter text first."); return; }
    setBusy("outputs"); setErr(null); setPanel("outputs");
    const active = window.GEN.PLATFORMS.map((pl) => pl.id);
    try {
      await persistChapter();
      const { outputs, order } = await window.GEN.generateOutputs(window.Store.getPiece(selectedId), active, BOOK_PLAT_AUD, refCtx,
        (pid, status) => setProg({ label: `Generating ${pid}…` }));
      window.Store.updatePiece(selectedId, { outputs, outputOrder: order });
      flash("Platform outputs ready");
    } catch (e) { setErr(e.message || "Output generation failed."); }
    setBusy(null); setProg(null);
  };

  const acceptRevision = () => {
    const p = window.Store.getPiece(selectedId);
    if (!p || !p.revision) return;
    window.Store.updatePiece(p.id, { original: p.revision.text, status: "Revised" });
    setDraft(p.revision.text);
    flash("Revision accepted into the draft");
  };

  // Download / Drive use the AI-free server assembler as the single source of
  // the manuscript markdown (GET /api/campaigns/:id/book/export).
  const downloadBook = async () => {
    setBusy("export"); setErr(null);
    try {
      await persistChapter();
      const res = await bookApi("GET", "/api/campaigns/" + bookCampaign.id + "/book/export");
      window.EXPORT.downloadText(res.markdown || "", window.EXPORT.safeName(res.title || bookCampaign.name) + "-book.md");
      flash("Book Markdown downloaded");
    } catch (e) { setErr(e.message || "Export failed."); }
    setBusy(null);
  };
  const uploadBook = async () => {
    setBusy("export"); setErr(null);
    try {
      await persistChapter();
      const res = await bookApi("GET", "/api/campaigns/" + bookCampaign.id + "/book/export");
      const up = await window.DRIVE.uploadFile(window.EXPORT.safeName(res.title || bookCampaign.name) + "-book.md", res.markdown || "", "text/markdown");
      flash("Uploaded to Drive" + (up && up.name ? " · " + up.name : ""));
    } catch (e) { setErr(e.message || "Drive upload failed."); }
    setBusy(null);
  };

  const setStatus = (s) => { const p = window.Store.getPiece(selectedId); if (p) window.Store.setStatus(p.id, s); };

  const panels = [
    { id: "sources", label: "Sources" },
    { id: "review", label: "Review", dot: piece && !!piece.packet },
    { id: "revision", label: "Revision", dot: piece && !!piece.revision },
    { id: "outputs", label: "Outputs", dot: piece && (piece.outputOrder || []).length > 0 },
  ];

  const noBook = !bookCampaign;
  const showChapters = !isMobile || (noBook ? true : mobilePane === "chapters");
  const showEditor = !isMobile || (noBook ? false : mobilePane === "editor");
  const showWorkflow = !isMobile || (noBook ? false : mobilePane === "workflow");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", minHeight: 0 }}>
      {/* mobile pane switcher */}
      {isMobile && !noBook && (
        <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--hair)", flexShrink: 0, background: "var(--paper)" }}>
          {[["chapters", "Chapters"], ["editor", "Editor"], ["workflow", "Workflow"]].map(([id, l]) => {
            const on = mobilePane === id;
            const dis = (id === "editor" || id === "workflow") && !piece;
            return (
              <button key={id} onClick={() => !dis && setMobilePane(id)} disabled={dis} className="mono"
                style={{ flex: 1, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", padding: "9px 4px", borderRadius: 999, border: "none",
                  cursor: dis ? "not-allowed" : "pointer", opacity: dis ? 0.4 : 1,
                  background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent-ink)" : "var(--ink-3)" }}>{l}</button>
            );
          })}
        </div>
      )}

      <ChapterList chapters={chapters} selectedId={selectedId} onSelect={selectChapter} onAdd={addChapter} role={role}
        campaigns={campaigns} bookId={bookId} onPickBook={pickBook} onNewBook={newBook}
        isMobile={isMobile} hidden={isMobile && !showChapters} />

      {/* editor region (also hosts the no-book / no-chapter states) */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: showEditor ? "flex" : "none", flexDirection: "column" }}>
        {noBook ? (
          <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
            <div style={{ textAlign: "center", maxWidth: 440 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Book Writer</div>
              <h2 style={{ fontSize: 28, marginBottom: 10 }}>Pick a book, or start a new one</h2>
              <p className="muted" style={{ fontSize: 15.5, marginBottom: 18 }}>A book is its own campaign with its own library of chapters — separate from your article campaigns. Choose an existing book from the list, or create a new one.</p>
              {role !== "assistant" && <button className="btn primary" onClick={newBook}><Icon name="plus" size={15} /> New book</button>}
            </div>
          </div>
        ) : !piece ? (
          <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
            <div style={{ textAlign: "center", maxWidth: 420 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Book Writer · {bookCampaign.name}</div>
              <h2 style={{ fontSize: 28, marginBottom: 10 }}>Write a book, one chapter at a time</h2>
              <p className="muted" style={{ fontSize: 15.5, marginBottom: 18 }}>This campaign is your book; each chapter runs through the same editorial engine — weave, the seven gates, revision, and platform outputs. Add your first chapter to begin.</p>
              {role !== "assistant" && <button className="btn primary" onClick={() => addChapter("Chapter 1")}><Icon name="plus" size={15} /> Add chapter 1</button>}
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: isMobile ? "12px 16px" : "16px 28px", borderBottom: "1px solid var(--hair)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveNow}
                  style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-display)", fontSize: isMobile ? 21 : 26, fontWeight: 500, letterSpacing: "-0.01em",
                    border: "1px solid transparent", background: "transparent", color: "var(--ink)", padding: "2px 6px", marginLeft: -6, borderRadius: 6 }}
                  onFocus={(e) => { e.target.style.background = "var(--paper-sunk)"; }}
                  onMouseLeave={(e) => { if (document.activeElement !== e.target) e.target.style.background = "transparent"; }} />
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {!isMobile && <span className="mono muted" style={{ fontSize: 11 }}>{wc(draft)} words</span>}
                  <select className="field" value={piece.status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto", fontSize: 12, padding: "5px 8px" }}>
                    {window.Store.STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {!isMobile && <button className="btn ghost sm" onClick={() => { saveNow(); if (onActivateCampaign) onActivateCampaign(bookId); onOpenPiece(piece.id); }} title="Open in the full editorial desk">Desk ↗</button>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn sm" onClick={saveNow} disabled={!dirty}><Icon name="check" size={13} /> Save</button>
                <input ref={draftFileRef} type="file" accept={window.UPLOAD_ACCEPT} style={{ display: "none" }} onChange={uploadDraft} />
                <button className="btn sm" onClick={() => draftFileRef.current.click()} disabled={!!busy || uploadingDraft} title="Load this chapter from a PDF, image, .docx, or text file">{uploadingDraft ? <Spinner size={13} /> : <Icon name="doc" size={13} />} Upload</button>
                <button className="btn sm" onClick={runReview} disabled={!!busy}>{busy === "review" ? <Spinner size={13} /> : <Icon name="flag" size={13} />} Review</button>
                <button className="btn sm" onClick={runRevise} disabled={!!busy || !piece.packet}>{busy === "revise" ? <Spinner size={13} /> : <Icon name="play" size={13} />} Revise</button>
                <label title="Full revision: restructure (strategy, audience, rigor, structure) then polish (clarity, tone, inoculation). Off = light pass only."
                  style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: fullRevise ? "var(--accent-ink)" : "var(--ink-3)", cursor: "pointer", userSelect: "none" }}>
                  <input type="checkbox" checked={fullRevise} onChange={(e) => setFullRevise(e.target.checked)} disabled={!!busy} /> Full
                </label>
                <button className="btn sm" onClick={runOutputs} disabled={!!busy}>{busy === "outputs" ? <Spinner size={13} /> : <Icon name="arrowR" size={13} />} {isMobile ? "Outputs" : "Generate outputs"}</button>
                <div style={{ flex: 1 }} />
                <button className="btn ghost sm" onClick={downloadBook} disabled={busy === "export"} title="Assemble all chapters into one Markdown file">{busy === "export" ? <Spinner size={13} /> : <Icon name="doc" size={13} />} {isMobile ? "Download" : "Download book"}</button>
                {window.DRIVE && window.DRIVE.isConfigured() && <button className="btn ghost sm" onClick={uploadBook} disabled={busy === "export"}>{busy === "export" ? <Spinner size={13} /> : <Icon name="book" size={13} />} To Drive</button>}
              </div>
              {(err || note || (busy && prog)) && (
                <div style={{ marginTop: 10, fontSize: 13, display: "flex", alignItems: "center", gap: 7,
                  color: err ? "var(--sev-must)" : "var(--accent-ink)" }}>
                  {busy && prog && <Spinner size={13} />}
                  {err || note || (prog && prog.label)}
                </div>
              )}
            </div>
            <div className="scroll-y" style={{ flex: 1, minHeight: 0 }}>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveNow} disabled={busy === "review" || busy === "weave"}
                placeholder="Write or paste your chapter here — or weave it from research in the Sources panel. The seven gates read this text."
                style={{ width: "100%", minHeight: "100%", border: "none", outline: "none", resize: "none", background: "transparent",
                  fontFamily: "var(--font-body)", fontSize: isMobile ? 16 : 17.5, lineHeight: 1.78, color: "var(--ink)", padding: isMobile ? "18px 18px" : "30px 40px", display: "block" }} />
            </div>
          </>
        )}
      </div>

      {/* workflow sidebar — only when a chapter is open */}
      {!noBook && piece && (
        <div style={{ width: isMobile ? "100%" : 384, flex: isMobile ? 1 : "none", flexShrink: 0,
          borderLeft: isMobile ? "none" : "1px solid var(--hair)",
          display: showWorkflow ? "flex" : "none", flexDirection: "column", minHeight: 0, background: "var(--paper)" }}>
          <div style={{ display: "flex", gap: 2, padding: "10px 12px", borderBottom: "1px solid var(--hair)" }}>
            {panels.map((pn) => {
              const on = pn.id === panel;
              return (
                <button key={pn.id} onClick={() => setPanel(pn.id)} className="mono"
                  style={{ flex: 1, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", padding: "7px 4px", borderRadius: 999, border: "none", cursor: "pointer",
                    background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent-ink)" : "var(--ink-3)", position: "relative",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                  {pn.label}{pn.dot && <span style={{ width: 5, height: 5, borderRadius: 99, background: "var(--accent)" }} />}
                </button>
              );
            })}
          </div>
          <div className="scroll-y" style={{ flex: 1, padding: "18px 20px" }}>
            {panel === "sources" && <SourcePack piece={piece} refCtx={refCtx} onDraft={(d) => setDraft(d)} busy={busy} setBusy={setBusy} setErr={setErr} />}
            {panel === "review" && <PacketView piece={piece} />}
            {panel === "revision" && <RevisionView piece={piece} onAccept={acceptRevision} accepting={false} />}
            {panel === "outputs" && <OutputsView piece={piece} />}
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { BookWriter, sortChapters, chapterText });
