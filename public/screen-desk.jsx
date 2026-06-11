/* Desk — durable idea-chat with folded memory.
   This is the one prototype improvement worth adopting into the working app:
   open editorial threads that can be promoted into real pieces. */

function deskUid(prefix) {
  try {
    if (window.crypto && window.crypto.randomUUID) return prefix + window.crypto.randomUUID();
  } catch (e) {}
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function newDeskThread() {
  return {
    id: deskUid("thread_"),
    title: "New thread",
    titleSet: false,
    messages: [],
    memory: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function estimateTokens(text) {
  return Math.ceil(((text || "").length) / 4);
}

function contextWindowFor(status) {
  const profile = effectiveLLMProfile(status);
  const provider = profile && profile.provider;
  const model = ((profile && profile.model) || "").toLowerCase();
  if (provider === "anthropic") return 200000;
  if (provider === "gemini") return model.includes("pro") ? 1000000 : 128000;
  if (provider === "openai" || provider === "xai") return 128000;
  if (model.includes("70b") || model.includes("128k")) return 128000;
  if (model.includes("32k")) return 32000;
  return 8192;
}

function effectiveLLMProfile(status) {
  if (!status) return null;
  const profiles = Array.isArray(status.profiles) ? status.profiles : [];
  const taskProfileId =
    status.tasks && status.tasks.utility && status.tasks.utility.profileId
      ? status.tasks.utility.profileId
      : null;
  const taskProfile = taskProfileId ? profiles.find((profile) => profile && profile.id === taskProfileId) : null;
  if (taskProfile) return taskProfile;
  const defaultProfile = status.defaultProfileId
    ? profiles.find((profile) => profile && profile.id === status.defaultProfileId)
    : null;
  if (defaultProfile) return defaultProfile;
  if (profiles.length) return profiles[0];
  return status.provider && status.model ? { provider: status.provider, model: status.model } : null;
}

function modelLabelFor(status) {
  const profile = effectiveLLMProfile(status);
  if (!profile || !profile.model) return "Model setup";
  const provider = {
    anthropic: "Anthropic",
    gemini: "Gemini",
    openai: "OpenAI",
    "openai-compatible": "Compatible",
    xai: "xAI",
    ollama: "Ollama",
  }[profile.provider] || "";
  return provider ? provider + " · " + profile.model : profile.model;
}

function deskUsedTokens(thread) {
  const live = (thread.messages || []).reduce((n, m) => n + estimateTokens(m.content), 0);
  const memory = thread.memory ? estimateTokens(thread.memory.note) : 0;
  return 320 + live + memory;
}

async function deskChatComplete(thread, campaignId) {
  const res = await fetch("/api/desk/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      mode: "desk",
      task: "utility",
      campaignId,
      messages: (thread.messages || []).map((m) => ({ role: m.role, content: m.content })),
      memory: thread.memory && thread.memory.note,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || "Desk chat failed.");
  return (data && data.text) || "";
}

async function compressDeskThread(thread, windowSize) {
  if (deskUsedTokens(thread) / windowSize < 0.72) return thread;
  let live = (thread.messages || []).slice();
  const fold = [];
  while (live.length > 4 && (320 + estimateTokens(thread.memory && thread.memory.note) + live.reduce((n, m) => n + estimateTokens(m.content), 0)) / windowSize > 0.5) {
    fold.push(live.shift());
  }
  if (!fold.length) return thread;
  const prior = thread.memory && thread.memory.note ? thread.memory.note : "(none)";
  const turns = fold.map((m) => (m.role === "user" ? "Author" : "Desk") + ": " + m.content).join("\n");
  let note = "";
  try {
    const res = await fetch("/api/llm/util", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        task: "utility",
        prompt: "Compress these earlier desk-chat turns into a terse continuity note, 3-6 sentences, preserving decisions, facts, names, and the throughline. Merge with the prior note.\n\nPrior note:\n" + prior + "\n\nTurns:\n" + turns,
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.text) note = data.text.trim();
  } catch (e) {}
  if (!note) {
    note = fold.map((m) => (m.role === "user" ? "Author wanted: " : "Desk noted: ") + (m.content || "").slice(0, 160)).join(" ");
  }
  return Object.assign({}, thread, {
    messages: live,
    memory: { note, covered: (thread.memory ? thread.memory.covered : 0) + fold.length },
    updatedAt: Date.now(),
  });
}

function safeHref(href) {
  const value = String(href || "").trim();
  return /^https?:\/\//i.test(value) || /^mailto:/i.test(value) ? value : "";
}

function renderInlineMarkdown(text, keyPrefix) {
  const source = String(text || "");
  const parts = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > last) parts.push(source.slice(last, match.index));
    const token = match[0];
    const key = keyPrefix + "-" + parts.length;
    if (token.startsWith("**")) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link ? safeHref(link[2]) : "";
      parts.push(href
        ? <a key={key} href={href} target="_blank" rel="noreferrer">{link[1]}</a>
        : token);
    }
    last = pattern.lastIndex;
  }
  if (last < source.length) parts.push(source.slice(last));
  return parts;
}

function MarkdownText({ text }) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    const content = paragraph.join(" ").trim();
    if (content) blocks.push({ type: "p", text: content });
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    blocks.push(list);
    list = null;
  }

  lines.forEach((line) => {
    const clean = line.trim();
    if (!clean) {
      flushParagraph();
      flushList();
      return;
    }
    const heading = clean.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      return;
    }
    const bullet = clean.match(/^[-*]\s+(.+)$/);
    const numbered = clean.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const type = numbered ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((bullet || numbered)[1]);
      return;
    }
    flushList();
    paragraph.push(clean);
  });
  flushParagraph();
  flushList();

  return (
    <div className="desk-markdown">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
          return <Tag key={index}>{renderInlineMarkdown(block.text, "h" + index)}</Tag>;
        }
        if (block.type === "ul" || block.type === "ol") {
          const Tag = block.type;
          return <Tag key={index}>{block.items.map((item, i) => <li key={i}>{renderInlineMarkdown(item, "li" + index + "-" + i)}</li>)}</Tag>;
        }
        return <p key={index}>{renderInlineMarkdown(block.text, "p" + index)}</p>;
      })}
    </div>
  );
}

function DeskBubble({ msg }) {
  const mine = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "min(760px, 86%)",
        lineHeight: 1.6,
        fontSize: 16,
        padding: "11px 14px",
        borderRadius: 14,
        borderTopLeftRadius: mine ? 14 : 4,
        borderTopRightRadius: mine ? 4 : 14,
        background: mine ? "var(--accent-soft)" : "var(--paper-2)",
        border: "1px solid " + (mine ? "color-mix(in oklab, var(--accent) 26%, transparent)" : "var(--hair)"),
      }}>
        {mine ? msg.content : <MarkdownText text={msg.content} />}
      </div>
    </div>
  );
}

function Desk({ campaignId, onOpenPiece, hydrated }) {
  const desk = window.Store.getDesk();
  const isMobile = window.useIsMobile();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [status, setStatus] = React.useState(null);
  const streamRef = React.useRef(null);
  const taRef = React.useRef(null);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/llm/status", { headers: { Accept: "application/json" } })
      .then((r) => r.ok ? r.json() : null)
      .then((s) => { if (alive && s) setStatus(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    if ((desk.threads || []).length) return;
    const t = newDeskThread();
    window.Store.setDesk({ threads: [t], activeId: t.id });
  }, [hydrated, desk.threads && desk.threads.length]);

  React.useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [desk.activeId, busy, desk.threads && desk.threads.map((t) => (t.messages || []).length).join(",")]);

  const threads = desk.threads || [];
  const active = threads.find((t) => t.id === desk.activeId) || threads[0];
  const isSetupHandoff = !!(active && active.source === "pillar_press_setup");
  const win = contextWindowFor(status);
  const used = active ? deskUsedTokens(active) : 0;
  const pct = Math.min(1, used / win);

  const saveThreads = (nextThreads, activeId) => window.Store.setDesk({ threads: nextThreads, activeId: activeId || (active && active.id) || null });
  const updateThread = (next) => saveThreads(threads.map((t) => t.id === next.id ? next : t), next.id);
  const addThread = () => {
    const t = newDeskThread();
    saveThreads([t].concat(threads), t.id);
  };
  const deleteThread = (id) => {
    const rest = threads.filter((t) => t.id !== id);
    const next = rest.length ? rest : [newDeskThread()];
    saveThreads(next, desk.activeId === id ? next[0].id : desk.activeId);
  };

  async function send() {
    const body = text.trim();
    if (!body || !active || busy) return;
    setText(""); setBusy(true); setErr(null);
    if (taRef.current) taRef.current.style.height = "auto";
    let t = Object.assign({}, active, {
      title: active.titleSet ? active.title : body.slice(0, 48),
      messages: (active.messages || []).concat([{ id: deskUid("msg_"), role: "user", content: body }]),
      updatedAt: Date.now(),
    });
    updateThread(t);
    try {
      const answer = await deskChatComplete(t, campaignId);
      t = Object.assign({}, t, {
        messages: t.messages.concat([{ id: deskUid("msg_"), role: "assistant", content: answer || "(No response returned.)" }]),
        updatedAt: Date.now(),
      });
      t = await compressDeskThread(t, win);
      updateThread(t);
    } catch (e) {
      setErr((e && e.message) || "Desk chat failed.");
      updateThread(t);
    }
    setBusy(false);
  }

  function grow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(150, ta.scrollHeight) + "px";
  }

  function promote() {
    if (!active || !(active.messages || []).length) return;
    const seed = active.messages
      .map((m) => (m.role === "user" ? "Author: " : "Desk: ") + m.content)
      .join("\n\n");
    const piece = window.Store.createPiece(active.title || "Desk thread", campaignId);
    window.Store.updatePiece(piece.id, { original: seed });
    onOpenPiece && onOpenPiece(piece.id);
  }

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "270px 1fr", minHeight: 0 }}>
      <div style={{ borderRight: isMobile ? "none" : "1px solid var(--hair)", borderBottom: isMobile ? "1px solid var(--hair)" : "none", background: "var(--paper-sunk)", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 14 }}>
          <button className="btn primary" onClick={addThread} style={{ width: "100%" }}><Icon name="plus" size={14} /> New thread</button>
        </div>
        <div className="eyebrow" style={{ padding: "0 18px 8px" }}>Desk threads</div>
        <div className="scroll-y" style={{ flex: 1, padding: "0 8px 12px", minHeight: 0 }}>
          {threads.map((t) => {
            const on = active && t.id === active.id;
            return (
              <button key={t.id} onClick={() => window.Store.setDesk({ threads, activeId: t.id })}
                style={{ all: "unset", cursor: "pointer", boxSizing: "border-box", display: "grid", gridTemplateColumns: "1fr auto", gap: 8, width: "100%", padding: "10px 11px", borderRadius: "var(--radius)", marginBottom: 3, background: on ? "var(--paper-2)" : "transparent", border: "1px solid " + (on ? "var(--hair)" : "transparent") }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: "var(--font-display)", fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || "New thread"}</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                    {t.source === "pillar_press_setup" ? "setup handoff · " : ""}{(t.messages || []).length} turns
                  </span>
                </span>
                <span onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }} title="Delete thread" style={{ color: "var(--ink-3)", padding: 2 }}><Icon name="trash" size={13} /></span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--hair)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="eyebrow" style={{ marginBottom: 5 }}>Context</div>
            <div style={{ height: 6, borderRadius: 999, border: "1px solid var(--hair)", background: "var(--paper-sunk)", overflow: "hidden" }}>
              <div style={{ width: (pct * 100) + "%", height: "100%", background: pct > 0.72 ? "var(--accent)" : "var(--ink-3)" }} />
            </div>
          </div>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{Math.round(used / 1000 * 10) / 10}k / {Math.round(win / 1000)}k</span>
          <button className="btn sm" onClick={() => window.dispatchEvent(new Event("pillarpress:open-model-setup"))}><Icon name="key" size={13} /> {modelLabelFor(status)}</button>
          <button className="btn sm" onClick={promote} disabled={!active || !(active.messages || []).length}><Icon name="doc" size={13} /> Send to Library</button>
        </div>

        <div ref={streamRef} className="scroll-y" style={{ flex: 1, minHeight: 0, padding: "24px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ maxWidth: 820, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
            {active && active.memory && (
              <div className="card" style={{ padding: "12px 14px", color: "var(--ink-2)", fontSize: 14, lineHeight: 1.55 }}>
                <div className="eyebrow" style={{ marginBottom: 5 }}>Folded memory · {active.memory.covered} turns</div>
                {active.memory.note}
              </div>
            )}
            {isSetupHandoff && (
              <div className="card" style={{ padding: "14px 16px", color: "var(--ink-2)", fontSize: 14.5, lineHeight: 1.55, borderColor: "color-mix(in oklab, var(--accent) 28%, var(--hair))" }}>
                <div className="eyebrow" style={{ marginBottom: 5 }}>Setup handoff</div>
                This thread starts from your onboarding transcript. Continue here with the same desk: ask for a first draft, gather sources, refine your preferences, or send the thread to the Library when it becomes a piece.
              </div>
            )}
            {active && !(active.messages || []).length && !busy && (
              <div style={{ textAlign: "center", padding: "46px 0 12px" }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, display: "grid", placeItems: "center", margin: "0 auto 14px", background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
                  <Icon name="sparkle" size={23} />
                </div>
                <h1 style={{ fontSize: 30 }}>The Desk</h1>
                <p className="muted" style={{ maxWidth: "48ch", margin: "8px auto 0", fontSize: 15.5 }}>Think out loud here. When a thread becomes useful, send it to the Library as a real piece.</p>
              </div>
            )}
            {active && (active.messages || []).map((m) => <DeskBubble key={m.id} msg={m} />)}
            {busy && <div style={{ display: "flex", justifyContent: "flex-start" }}><div className="card" style={{ padding: "11px 14px" }}><Spinner size={14} /> Thinking…</div></div>}
            {err && <p style={{ color: "var(--sev-must)", fontSize: 13.5 }}>{err}</p>}
          </div>
        </div>

        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid var(--hair)", background: "var(--paper)" }}>
          <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end", background: "var(--paper-2)", border: "1px solid var(--hair-2)", borderRadius: 14, padding: "8px 8px 8px 14px" }}>
            <textarea ref={taRef} value={text} rows={1}
              onChange={(e) => { setText(e.target.value); grow(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Write to the desk..."
              style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", color: "var(--ink)", fontFamily: "var(--font-body)", fontSize: 16, lineHeight: 1.55, padding: "6px 0", maxHeight: 150 }} />
            <button className="btn primary" disabled={!text.trim() || busy || !active} onClick={send} style={{ width: 42, height: 42, padding: 0 }} title="Send">
              {busy ? <Spinner size={15} /> : <Icon name="arrowR" size={17} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Desk });
