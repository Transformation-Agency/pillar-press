/* Common UI — icons, chips, copy buttons, tabs. Exports to window. */

const ICONS = {
  plus: "M10 4v12M4 10h12",
  check: "M4 10.5l4 4 8-9",
  copy: "M7 7h8v9H7zM5 13H4V4h9v1",
  sun: "M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4",
  moon: "M16 11.5A6 6 0 018.5 4 6 6 0 1016 11.5z",
  chevR: "M8 5l5 5-5 5",
  chevD: "M5 8l5 5 5-5",
  arrowR: "M4 10h12M11 5l5 5-5 5",
  back: "M16 10H4M9 5l-5 5 5 5",
  doc: "M6 3h5l3 3v11H6zM11 3v3h3",
  book: "M5 4h7a2 2 0 012 2v10H7a2 2 0 00-2 2V4z",
  gear: "M10 7a3 3 0 100 6 3 3 0 000-6zM10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.5 1.5M14 14l1.5 1.5M15.5 4.5L14 6M6 14l-1.5 1.5",
  play: "M6 4l10 6-10 6V4z",
  trash: "M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11",
  dot: "M10 10",
  jump: "M5 10h10M10 5l5 5-5 5",
  warn: "M10 3l8 14H2zM10 8v4M10 14v.5",
  flag: "M5 3v14M5 4h9l-2 3 2 3H5",
  pause: "M7 4v12M13 4v12",
  image: "M3 4h14v12H3zM3 13l4-4 3 3 3-3 4 4M7 8a1 1 0 100-2 1 1 0 000 2z",
  film: "M4 4h12v12H4zM7 4v12M13 4v12",
  mic: "M10 3a2 2 0 012 2v4a2 2 0 11-4 0V5a2 2 0 012-2zM6 9a4 4 0 008 0M10 13v3M7 16h6",
  sparkle: "M10 3l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6z",
  key: "M12 4a4 4 0 00-3.9 5L3 14v3h3v-2h2v-2h1.1A4 4 0 1012 4zM13.5 7.5h.01",
  upload: "M10 13V4M6 8l4-4 4 4M4 15h12",
  rss: "M5 15a1 1 0 100-2 1 1 0 000 2zM4 10a6 6 0 016 6M4 5a11 11 0 0111 11",
  globe: "M10 3a7 7 0 100 14 7 7 0 000-14zM3 10h14M10 3c2.2 2 3.2 4.5 3.2 7s-1 5-3.2 7c-2.2-2-3.2-4.5-3.2-7s1-5 3.2-7z",
  db: "M10 3c3.3 0 6 1 6 2.2S13.3 7.4 10 7.4 4 6.4 4 5.2 6.7 3 10 3zM4 5.2v9.6C4 16 6.7 17 10 17s6-1 6-2.2V5.2M4 10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2",
  xLogo: "M4.5 4.5l11 11M15.5 4.5l-11 11",
};

function Icon({ name, size = 18, style }) {
  const d = ICONS[name];
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      style={style} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const STATUS_VAR = {
  Draft: "--st-draft", Reviewed: "--st-reviewed", Revised: "--st-revised",
  Approved: "--st-approved", Formatted: "--st-formatted",
};

function StatusChip({ status, onClick }) {
  return (
    <span className="chip" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <span className="dot" style={{ background: `var(${STATUS_VAR[status] || "--st-draft"})` }} />
      {status}
    </span>
  );
}

function SeverityDot({ sev }) {
  const s = window.SEVERITY[sev] || window.SEVERITY.note;
  return <span style={{ width: 8, height: 8, borderRadius: 99, background: `var(${s.varc})`, display: "inline-block", flexShrink: 0 }} />;
}

function SeverityTag({ sev }) {
  const s = window.SEVERITY[sev] || window.SEVERITY.note;
  return (
    <span className="mono" style={{
      fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500,
      padding: "2px 7px", borderRadius: 999, color: `var(${s.varc})`, background: `var(${s.bg})`,
      whiteSpace: "nowrap",
    }}>{s.label}</span>
  );
}

function CopyButton({ text, label = "Copy", small = true }) {
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = typeof text === "function" ? text() : text;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      document.body.removeChild(ta);
    }
    setDone(true); setTimeout(() => setDone(false), 1400);
  };
  return (
    <button className={"btn ghost" + (small ? " sm" : "")} onClick={copy} title="Copy to clipboard">
      <Icon name={done ? "check" : "copy"} size={14} />
      {done ? "Copied" : label}
    </button>
  );
}

function Spinner({ size = 16 }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="var(--hair-2)" strokeWidth="2" />
      <path d="M10 3a7 7 0 017 7" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--hair)", overflowX: "auto", maxWidth: "100%" }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} disabled={t.disabled}
            style={{
              fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 500, flexShrink: 0, whiteSpace: "nowrap",
              padding: "12px 18px", border: "none", background: "none", cursor: t.disabled ? "not-allowed" : "pointer",
              color: on ? "var(--ink)" : (t.disabled ? "var(--ink-3)" : "var(--ink-2)"),
              opacity: t.disabled ? 0.5 : 1,
              borderBottom: on ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1, display: "flex", alignItems: "center", gap: 8, transition: "color 0.15s",
            }}>
            {t.label}
            {t.badge != null && (
              <span className="mono" style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 999,
                background: on ? "var(--accent-soft)" : "var(--paper-sunk)",
                color: on ? "var(--accent-ink)" : "var(--ink-3)",
              }}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function relTime(ts) {
  const d = (Date.now() - ts) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* Responsive helper: true when the viewport is at/below `bp` px. Drives the
   stacking of inline grid/fixed-width layouts that CSS media queries can't
   override. */
function useIsMobile(bp = 760) {
  const query = "(max-width: " + bp + "px)";
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [m, setM] = React.useState(get);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener("change", on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", on); else mq.removeListener(on); };
  }, [query]);
  return m;
}

/* Read an uploaded file into research text. Text-like files are decoded in the
   browser; PDFs, images, and .docx go to /api/extract (LLM fallback / mammoth). */
const UPLOAD_TEXT_EXT = ["txt", "md", "markdown", "csv", "tsv", "json", "log", "html", "htm", "xml", "yaml", "yml", "rtf"];
async function extractFileText(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (UPLOAD_TEXT_EXT.indexOf(ext) >= 0 || /^text\//.test(file.type || "")) {
    try { return await file.text(); } catch (e) { /* fall through to server */ }
  }
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/extract", { method: "POST", body: fd, credentials: "same-origin" });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((d && d.error) || ("Couldn't read " + file.name + "."));
  return (d && d.text) || "";
}
// Broad accept list for the upload inputs.
const UPLOAD_ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.log,.html,.htm,.xml,.yaml,.yml,.rtf,.pdf,.docx,.png,.jpg,.jpeg,.gif,.webp,text/*,application/pdf,image/*";

Object.assign(window, { Icon, StatusChip, SeverityDot, SeverityTag, CopyButton, Spinner, Tabs, relTime, STATUS_VAR, useIsMobile, extractFileText, UPLOAD_ACCEPT });
