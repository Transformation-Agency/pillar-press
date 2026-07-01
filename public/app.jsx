/* App root — topbar, routing, role + theme, and the piece Workspace
   that orchestrates the sequential gate run. */

function useStore() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => window.Store.subscribe(force), []);
  return window.Store.getState();
}

function useHostedAuth() {
  const initial = () => window.KP_AUTH
    ? window.KP_AUTH.snapshot()
    : { ready: true, requiresLogin: false, authenticated: true };
  const [auth, setAuth] = React.useState(initial);
  React.useEffect(() => {
    if (!window.KP_AUTH) return undefined;
    return window.KP_AUTH.subscribe(setAuth);
  }, []);
  return auth;
}

function friendlyHostedAuthError(message) {
  const raw = String(message || "").trim();
  const rateLimit = raw.match(/only request this after\s+(\d+)\s+seconds?/i);
  if (rateLimit) {
    const seconds = Number(rateLimit[1]) || 30;
    return {
      message: `Pillar Press is protecting account creation from repeated requests. Please wait ${seconds} seconds, then try again. If you already created this account, choose “I already have an account.”`,
      waitSeconds: seconds,
    };
  }
  if (/invalid login credentials/i.test(raw)) {
    return {
      message: "That email and password did not match. Check the password, or create an account if this is your first time here.",
      waitSeconds: 0,
    };
  }
  if (/email not confirmed/i.test(raw)) {
    return {
      message: "That account still needs email confirmation. Check your inbox, then come back and sign in.",
      waitSeconds: 0,
    };
  }
  if (/already registered|already exists|user already/i.test(raw)) {
    return {
      message: "That email already has an account. Choose “I already have an account” and sign in.",
      waitSeconds: 0,
    };
  }
  return {
    message: raw || "Could not sign in.",
    waitSeconds: 0,
  };
}

function HostedAuthScreen({ auth }) {
  const [mode, setMode] = React.useState("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passwordConfirm, setPasswordConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [cooldownUntil, setCooldownUntil] = React.useState(0);
  const [now, setNow] = React.useState(Date.now());
  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  React.useEffect(() => {
    if (!cooldownUntil) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  React.useEffect(() => {
    if (auth && auth.recovery) {
      setMode("resetPassword");
      setError("");
      setMessage("Choose a new password for your Pillar Press account.");
    }
  }, [auth && auth.recovery]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "resetRequest") {
        await window.KP_AUTH.requestPasswordReset(email.trim());
        setMessage("Check your email for a password reset link.");
        return;
      }

      if (mode === "resetPassword") {
        if (password !== passwordConfirm) throw new Error("Passwords do not match.");
        const result = await window.KP_AUTH.updateRecoveredPassword(password);
        setMessage("Password updated. Opening your desk.");
        if (result && result.passwordUpdated) await window.Store.reload();
        return;
      }

      const result = mode === "signup"
        ? await window.KP_AUTH.signUp(email.trim(), password)
        : await window.KP_AUTH.signIn(email.trim(), password);
      if (result && result.confirmationRequired) {
        setMode("signin");
        setPassword("");
        setMessage("Check your email to confirm the account, then come back and sign in.");
      } else {
        await window.Store.reload();
      }
    } catch (err) {
      const friendly = friendlyHostedAuthError(err && err.message ? err.message : "Could not sign in.");
      setError(friendly.message);
      if (friendly.waitSeconds > 0) {
        setCooldownUntil(Date.now() + friendly.waitSeconds * 1000);
        setNow(Date.now());
      }
    } finally {
      setBusy(false);
    }
  };

  if (!auth.ready) {
    return (
      <main className="empty">
        <Spinner size={22} />
        <h1>Opening Pillar Press</h1>
        <p>Checking your session.</p>
      </main>
    );
  }

  if (!auth.configured) {
    return (
      <main className="empty">
        <h1>Hosted auth needs configuration</h1>
        <p>Add the hosted Supabase URL and anon key, then redeploy Pillar Press.</p>
      </main>
    );
  }

  return (
    <main style={{
      minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
      background: "var(--paper)", color: "var(--ink)",
    }}>
      <form onSubmit={submit} style={{
        width: "min(440px, 100%)", border: "1px solid var(--hair)", borderRadius: 16,
        background: "var(--paper-2)", boxShadow: "var(--shadow-lg)", padding: 28,
      }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Pillar Press</div>
        <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 500 }}>
          {mode === "signup"
            ? "Create your account"
            : mode === "resetRequest"
              ? "Reset your password"
              : mode === "resetPassword"
                ? "Choose a new password"
                : "Sign in"}
        </h1>
        <p style={{ color: "var(--muted)", lineHeight: 1.5, margin: "10px 0 22px" }}>
          {mode === "resetRequest"
            ? "Enter your account email and Pillar Press will send a reset link."
            : mode === "resetPassword"
              ? "Set a new password to continue into your workspace."
              : "Your workspace, campaigns, preferences, and writing history stay scoped to your account."}
        </p>

        {mode !== "resetPassword" && (
          <>
            <label className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="email"
              style={{ width: "100%", marginBottom: 14 }}
              placeholder="you@example.com"
            />
          </>
        )}

        {mode !== "resetRequest" && (
          <>
            <label className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
              {mode === "resetPassword" ? "New password" : "Password"}
            </label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              style={{ width: "100%", marginBottom: mode === "resetPassword" ? 14 : 18 }}
              placeholder={mode === "resetPassword" ? "New password" : "Your password"}
            />
          </>
        )}

        {mode === "resetPassword" && (
          <>
            <label className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Confirm password</label>
            <input
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              style={{ width: "100%", marginBottom: 18 }}
              placeholder="Confirm new password"
            />
          </>
        )}

        {error && <p role="alert" style={{ color: "var(--sev-must)", margin: "0 0 12px" }}>{error}</p>}
        {message && <p role="status" style={{ color: "var(--muted)", margin: "0 0 12px" }}>{message}</p>}

        <button className="btn primary" type="submit" disabled={busy || cooldownSeconds > 0} style={{ width: "100%", justifyContent: "center" }}>
          {busy
            ? <Spinner size={15} />
            : cooldownSeconds > 0
              ? `Try again in ${cooldownSeconds}s`
              : mode === "signup"
              ? "Create account"
              : mode === "resetRequest"
                ? "Send reset link"
                : mode === "resetPassword"
                  ? "Update password"
                  : "Sign in"}
        </button>
        {mode === "signin" && (
          <>
            <button
              className="link"
              type="button"
              onClick={() => { setMode("resetRequest"); setError(""); setMessage(""); setPassword(""); setPasswordConfirm(""); setCooldownUntil(0); }}
              style={{ marginTop: 16, width: "100%", textAlign: "center" }}
            >
              Forgot your password?
            </button>
            <button
              className="link"
              type="button"
              onClick={() => { setMode("signup"); setError(""); setMessage(""); setPassword(""); setPasswordConfirm(""); setCooldownUntil(0); }}
              style={{ marginTop: 10, width: "100%", textAlign: "center" }}
            >
              Create an account
            </button>
          </>
        )}
        {mode === "signup" && (
          <button
            className="link"
            type="button"
            onClick={() => { setMode("signin"); setError(""); setMessage(""); setPassword(""); setPasswordConfirm(""); setCooldownUntil(0); }}
            style={{ marginTop: 16, width: "100%", textAlign: "center" }}
          >
            I already have an account
          </button>
        )}
        {mode === "resetRequest" && (
          <button
            className="link"
            type="button"
            onClick={() => { setMode("signin"); setError(""); setMessage(""); setPassword(""); setPasswordConfirm(""); setCooldownUntil(0); }}
            style={{ marginTop: 16, width: "100%", textAlign: "center" }}
          >
            Back to sign in
          </button>
        )}
      </form>
    </main>
  );
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
  const [reviewError, setReviewError] = React.useState("");
  const [reviewJumpGate, setReviewJumpGate] = React.useState(null);
  const isMobile = window.useIsMobile();

  const update = (patch) => window.Store.updatePiece(piece.id, patch);

  const runGates = async () => {
    setReviewError("");
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
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error((body && (body.error || body.message)) || ("Review failed: " + r.status));
      const { packet, status } = body || {};
      // All gates done; sync the local cache (packet already persisted server-side).
      const finalStatus = {}; window.GATES.forEach((g) => finalStatus[g.id] = (packet && packet[g.id]) ? "done" : "pending"); setGateStatus(finalStatus);
      window.Store.updatePiece(piece.id, { packet, status: status || "Reviewed" });
      setRunning(false);
      if (packet && Object.keys(packet).length) { setReviewJumpGate(null); setTab("review"); }
    } catch (e) {
      polling = false;
      console.error("Review failed:", e);
      setGateStatus((s) => {
        const next = { ...s };
        window.GATES.forEach((g) => { if (next[g.id] === "running") next[g.id] = "error"; });
        return next;
      });
      setReviewError((e && e.message) || "Review failed.");
      setRunning(false);
    }
  };

  const refCtx = window.AI.refContext(refs);
  const findingCount = piece.packet ? window.GATES.reduce((n, g) => n + (piece.packet[g.id] ? piece.packet[g.id].findings.length : 0), 0) : null;
  const openReview = (gateId = null) => {
    setReviewJumpGate(gateId || null);
    setTab("review");
  };

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
        <Tabs tabs={tabs} active={tab} onChange={(next) => { if (next !== "review") setReviewJumpGate(null); setTab(next); }} />
      </div>

      {/* tab body */}
      {tab === "draft" && (
        <DraftTab piece={piece} running={running} gateStatus={gateStatus} reviewError={reviewError}
          onRun={runGates} onChangeOriginal={(t) => update({ original: t })}
          onGoReview={openReview} />
      )}
      {tab === "review" && (piece.packet
        ? <ReviewTab piece={piece} jumpGate={reviewJumpGate} />
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
  Literary: { display: 'Georgia, "Times New Roman", serif', body: 'Georgia, "Times New Roman", serif', note: "Georgia" },
  Newsroom: { display: '"Times New Roman", Times, serif', body: '"Times New Roman", Times, serif', note: "Times" },
  Quiet:    { display: 'ui-serif, Georgia, Cambria, "Times New Roman", serif', body: 'ui-serif, Georgia, Cambria, "Times New Roman", serif', note: "System serif" },
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
        <button key={id} onClick={() => onChange(id)} className="mono" title={id === "assistant" ? "Assistant can edit drafts and outputs, but not Preferences" : "Full access"}
          style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "5px 11px", borderRadius: 999, border: "none", cursor: "pointer",
            background: role === id ? "var(--paper-2)" : "transparent", color: role === id ? "var(--ink)" : "var(--ink-3)",
            boxShadow: role === id ? "var(--shadow-sm)" : "none" }}>{l}</button>
      ))}
    </div>
  );
}

function CampaignSwitcher({ campaigns, activeId, pieceCounts, onSelect, onAdd }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const active = campaigns.find((c) => c.id === activeId) || campaigns[0];
  const counts = pieceCounts || {};
  const activeCount = active ? (counts[active.id] || 0) : 0;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} title="Switch campaign"
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          border: "1px solid var(--hair-2)", background: "var(--paper-2)", color: "var(--ink)",
          borderRadius: 999, padding: "6px 12px", height: 34 }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--accent)" }} />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 15, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active ? active.name : "No campaign"}</span>
        {active && (
          <span className="mono" style={{
            fontSize: 10.5, color: "var(--ink-3)", border: "1px solid var(--hair)",
            borderRadius: 999, padding: "2px 6px", lineHeight: 1,
          }}>{activeCount}</span>
        )}
        <Icon name="chevD" size={14} style={{ color: "var(--ink-3)" }} />
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", top: 42, right: 0, width: 292, padding: 6, zIndex: 60, boxShadow: "var(--shadow-lg)", maxHeight: "70vh", overflowY: "auto" }}>
          <div className="eyebrow" style={{ padding: "6px 10px 4px" }}>Campaign · pieces</div>
          {!campaigns.length && (
            <div className="muted" style={{ padding: "8px 10px", fontSize: 13.5 }}>No campaigns yet.</div>
          )}
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
                <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: on ? "var(--accent)" : "var(--hair-2)" }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "0 0 auto" }}>
                  <span className="mono" style={{ fontSize: 10.5, color: on ? "var(--accent-ink)" : "var(--ink-3)" }}>
                    {counts[c.id] || 0}
                  </span>
                  {on && <Icon name="check" size={15} />}
                </span>
              </button>
            );
          })}
          <hr className="rule" style={{ margin: "5px 4px" }} />
          <button onClick={() => { onAdd(); setOpen(false); }}
            className="mono" style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, border: "none", background: "transparent", cursor: "pointer", borderRadius: "var(--radius)", padding: "9px 10px", color: "var(--ink-3)", fontSize: 12, letterSpacing: "0.04em" }}>
            <Icon name="plus" size={13} /> NEW CAMPAIGN
          </button>
        </div>
      )}
    </div>
  );
}

const LIBRARY_VIEWS = new Set(["library", "workspace", "weave", "studio"]);
function isLibraryView(view) { return LIBRARY_VIEWS.has(view); }

function LibraryMenuButton({ view, onSelect }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const items = [
    { id: "pieces", label: "Pieces", active: view === "library" || view === "workspace" },
    { id: "weave", label: "Weave", active: view === "weave" },
    { id: "studio", label: "Studio", active: view === "studio" },
  ];
  return (
    <div ref={ref} className="nav-menu" style={{ position: "relative" }}>
      <button
        className={"nav-menu-trigger " + (isLibraryView(view) ? "active" : "")}
        onClick={() => setOpen((o) => !o)}
        title="Open Library sections"
      >
        Library <Icon name="chevD" size={12} style={{ marginLeft: 4 }} />
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", top: 38, left: 0, width: 172, padding: 6, zIndex: 65, boxShadow: "var(--shadow-lg)" }}>
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => { onSelect(item.id); setOpen(false); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                border: "none", background: item.active ? "var(--accent-soft)" : "transparent", cursor: "pointer",
                borderRadius: "var(--radius)", padding: "9px 10px", color: item.active ? "var(--accent-ink)" : "var(--ink)",
                fontFamily: "var(--font-body)", fontSize: 15, textAlign: "left", textTransform: "none", letterSpacing: 0,
              }}
              onMouseEnter={(e) => { if (!item.active) e.currentTarget.style.background = "var(--paper-sunk)"; }}
              onMouseLeave={(e) => { if (!item.active) e.currentTarget.style.background = "transparent"; }}
            >
              <span>{item.label}</span>
              {item.active && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignCreateDialog({ open, onClose, onCreate }) {
  const [name, setName] = React.useState("Pillar Press");
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    setName("Pillar Press");
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 0);
  }, [open]);
  if (!open) return null;
  const submit = () => {
    const clean = name.trim();
    if (!clean) return;
    onCreate(clean);
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 210, background: "oklch(0 0 0 / 0.32)", display: "grid", placeItems: "center", padding: 20 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="kp-new-campaign-title" className="card" style={{ width: "min(520px, 100%)", padding: "26px 28px", boxShadow: "var(--shadow-lg)" }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>New campaign</div>
        <h2 id="kp-new-campaign-title" style={{ fontSize: 25, margin: "0 0 10px" }}>Name this body of work</h2>
        <p className="muted" style={{ margin: "0 0 18px", fontSize: 14.5, lineHeight: 1.5 }}>
          Campaigns hold pieces, preferences, Gather sources, and Studio media together.
        </p>
        <input
          ref={inputRef}
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="Campaign name"
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}><Icon name="plus" size={14} /> Create campaign</button>
        </div>
      </div>
    </div>
  );
}

function DesktopOnboarding() {
  const [open, setOpen] = React.useState(false);
  const [setupSource, setSetupSource] = React.useState("local");
  const [setupMode, setSetupMode] = React.useState("ollama");
  const [status, setStatus] = React.useState(null);
  const [models, setModels] = React.useState([]);
  const [dockerModels, setDockerModels] = React.useState([]);
  const [localCompatibleModels, setLocalCompatibleModels] = React.useState([]);
  const [cloudListedModels, setCloudListedModels] = React.useState({});
  const [model, setModel] = React.useState("llama3.2");
  const [dockerBaseUrl, setDockerBaseUrl] = React.useState("http://localhost:12434/engines/v1");
  const [lmStudioBaseUrl, setLmStudioBaseUrl] = React.useState("http://127.0.0.1:1234/v1");
  const [cloudProvider, setCloudProvider] = React.useState("openai");
  const [cloudBaseUrl, setCloudBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [savedSettings, setSavedSettings] = React.useState(null);
  const [profileName, setProfileName] = React.useState("");
  const [taskDefaults, setTaskDefaults] = React.useState({});
  const [modelSetupContext, setModelSetupContext] = React.useState(null);
  const modelSetupRef = React.useRef(null);

  const desktop = window.PILLAR_DESKTOP;
  const authSnapshot = window.KP_AUTH && window.KP_AUTH.snapshot ? window.KP_AUTH.snapshot() : {};
  const isDesktopSetup = !!(desktop && desktop.isDesktop && desktop.isDesktop());
  const isHostedSetup = !!(authSnapshot && authSnapshot.hosted && !isDesktopSetup);
  const setupCompleteKey = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.computeSetupLocalStorageKey) || "pillarpress.desktopSetupComplete";
  const fallbackOllamaModels = ["gemma4:26b-mlx", "llama3.2", "qwen2.5:latest", "mistral"];
  const cloudModels = {
    openai: ["gpt-5.2", "gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
    anthropic: ["claude-haiku-4-5", "claude-sonnet-4-5"],
    gemini: ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    xai: ["grok-4.3", "grok-3-mini"],
    "openai-compatible": ["local-model"],
  };
  const cloudProviderOptions = [
    { id: "openai", name: "OpenAI", label: "Default: gpt-5.2", logoSrc: "brand/providers/openai.svg", description: "Strong default for drafting, utility work, and web-aware Desk chat." },
    { id: "anthropic", name: "Anthropic", label: "Default: claude-haiku-4-5", logoSrc: "brand/providers/anthropic.svg", description: "Careful long-form writing, review, and structured reasoning." },
    { id: "gemini", name: "Gemini", label: "Default: gemini-3.5-flash", logoSrc: "brand/providers/gemini.svg", description: "Fast multimodal and broad-context workflows." },
    { id: "xai", name: "xAI", label: "Default: grok-4.3", logoSrc: "brand/providers/xai.svg", description: "Grok models for teams already using xAI keys." },
    { id: "openai-compatible", name: "Compatible", label: "Custom endpoint", logoSrc: "brand/providers/api.svg", description: "Use another OpenAI-compatible cloud endpoint." },
  ];
  const localProviderOptions = [
    { id: "ollama", name: "Ollama", logoSrc: "brand/providers/ollama.svg", description: "Run downloaded models on this Mac." },
    { id: "lmstudio", name: "LM Studio", logoSrc: "brand/providers/api.svg", description: "Use models loaded through LM Studio's local OpenAI-compatible server." },
    { id: "docker", name: "Docker Model Runner", logoSrc: "brand/providers/docker.svg", description: "Use Docker Desktop's local OpenAI-compatible endpoint." },
  ];
  const taskOptions = [
    { id: "gather", label: "Gather" },
    { id: "weave", label: "Weave" },
    { id: "draft", label: "Draft" },
    { id: "review", label: "Review" },
    { id: "revision", label: "Revision" },
    { id: "outputs", label: "Outputs" },
    { id: "utility", label: "Utility" },
    { id: "mediaPrompt", label: "Media prompts" },
    { id: "file", label: "File extraction" },
  ];

  const providerLabel = (provider) => ({
    openai: "OpenAI / ChatGPT",
    anthropic: "Anthropic",
    gemini: "Gemini",
    xai: "xAI / Grok",
    ollama: "Ollama",
    lmstudio: "LM Studio",
    docker: "Docker Model Runner",
    "openai-compatible": "OpenAI-compatible",
  }[provider] || provider || "Provider");

  const profileIdFor = (profile) =>
    String([profile.provider, profile.baseUrl || "", profile.model].join("-"))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "llm-profile";
  const preferGemma = (items) => {
    const values = (items || []).filter((item) => item && !/embed/i.test(item));
    return values.slice().sort((a, b) => {
      const aGemma = /^gemma4/i.test(a) ? 0 : /^gemma/i.test(a) ? 1 : 2;
      const bGemma = /^gemma4/i.test(b) ? 0 : /^gemma/i.test(b) ? 1 : 2;
      return aGemma - bGemma || a.localeCompare(b);
    });
  };
  const suggestedOllamaModels = () => fallbackOllamaModels.filter((m) => !models.includes(m));
  const uniqueModelOptions = (items) => Array.from(new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean)));
  const defaultModelFor = (provider) => (cloudModels[provider] && cloudModels[provider][0]) || "";
  const modelOptionsFor = (provider, detectedModels) => {
    const base = uniqueModelOptions((detectedModels && detectedModels.length ? detectedModels : cloudModels[provider]) || []);
    return base.filter((m) => {
      const name = String(m || "").toLowerCase();
      if (!name || /embed|embedding|image|audio|tts|whisper|moderation|babbage|davinci|dall-e|transcribe|speech/i.test(name)) return false;
      return true;
    });
  };
  const modelOptionsForSetup = () => {
    if (setupMode === "ollama") return uniqueModelOptions(models.concat(suggestedOllamaModels()));
    if (setupMode === "docker") return uniqueModelOptions(dockerModels);
    if (setupMode === "lmstudio") return uniqueModelOptions(localCompatibleModels);
    const listed = cloudListedModels[cloudProvider] || [];
    return modelOptionsFor(cloudProvider, listed);
  };

  const profilesFromSettings = (settings) => {
    if (settings && Array.isArray(settings.profiles) && settings.profiles.length) return settings.profiles;
    if (settings && settings.provider && settings.model) {
      return [{
        id: "default",
        label: "Default",
        provider: settings.provider,
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
      }];
    }
    return [];
  };

  const activeProfileFromSettings = (settings) => {
    const profiles = profilesFromSettings(settings);
    return profiles.find((p) => p.id === settings?.defaultProfileId) || profiles[0] || null;
  };

  const notifyModelSetupSaved = (settings, profile) => {
    if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.notifyProviderSetupSaved) {
      window.KP_ONBOARDING_ACTIONS.notifyProviderSetupSaved({ profile: profile || activeProfileFromSettings(settings) || settings });
    }
  };

  const closeModelSetup = () => {
    if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.notifyProviderSetupClosed) {
      window.KP_ONBOARDING_ACTIONS.notifyProviderSetupClosed({ saved: false });
    }
    setOpen(false);
  };

  React.useEffect(() => {
    if (!isDesktopSetup && !isHostedSetup) return;
    let active = true;
    let unlisten = null;
    refresh({ syncSetupOpen: true }).catch(() => {
      if (active && window.localStorage.getItem(setupCompleteKey) !== "true") setOpen(true);
    });

    if (isDesktopSetup) {
      desktop.onShowModelSetup((() => {
        if (!active) return;
        setOpen(true);
        refresh();
      })).then((fn) => {
        unlisten = fn;
        if (!active && typeof unlisten === "function") unlisten();
      }).catch(() => {});
    }

    const openFromDesk = (event) => {
      if (!active) return;
      setModelSetupContext((event && event.detail) || null);
      setOpen(true);
      refresh();
    };
    window.addEventListener("pillarpress:open-model-setup", openFromDesk);

    return () => {
      active = false;
      if (typeof unlisten === "function") unlisten();
      window.removeEventListener("pillarpress:open-model-setup", openFromDesk);
    };
  }, [isDesktopSetup, isHostedSetup]);

  const isDockerModelRunnerSettings = (saved) =>
    !!(saved && saved.provider === "openai-compatible" && saved.baseUrl && saved.baseUrl.includes("12434"));
  const isLmStudioSettings = (saved) =>
    !!(saved && saved.provider === "openai-compatible" && saved.baseUrl && saved.baseUrl.includes("1234"));
  const isSavedSecret = (value) => typeof value === "string" && /^saved:/i.test(value);
  const profileHasApiKey = (profile) => !!(profile && (profile.apiKey || profile.hasApiKey));
  const savedCloudProfileFor = (provider) => profilesFromSettings(savedSettings).find((p) => p.provider === provider && !isDockerModelRunnerSettings(p) && !isLmStudioSettings(p));
  const usableApiKey = () => {
    const key = apiKey.trim();
    return isSavedSecret(key) ? "" : key;
  };
  const pickDetectedModel = (items, fallback) => {
    const clean = uniqueModelOptions(items);
    return clean[0] || fallback || "";
  };

  const fetchOpenAICompatibleModels = async (baseUrl) => {
    const res = await fetch("/api/llm/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "openai-compatible", baseUrl }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not list models.");
    return json.models || [];
  };

  const providerBaseUrl = (provider) => ({
    openai: "https://api.openai.com/v1",
    xai: "https://api.x.ai/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    anthropic: "https://api.anthropic.com/v1",
    ollama: "http://127.0.0.1:11434",
  }[provider] || "");

  const currentProviderConfig = () => {
    let config;
    if (setupMode === "ollama") {
      config = { provider: "ollama", model: model.trim(), baseUrl: "http://127.0.0.1:11434" };
    } else if (setupMode === "docker" || setupMode === "lmstudio") {
      config = {
        provider: "openai-compatible",
        model: model.trim(),
        baseUrl: setupMode === "lmstudio"
          ? (lmStudioBaseUrl.trim() || "http://127.0.0.1:1234/v1")
          : (dockerBaseUrl.trim() || "http://localhost:12434/engines/v1"),
      };
    } else {
      config = {
        provider: cloudProvider,
        model: model.trim(),
        apiKey: usableApiKey(),
        baseUrl: cloudProvider === "openai-compatible"
          ? cloudBaseUrl.trim()
          : providerBaseUrl(cloudProvider),
      };
    }
    const active = activeProfileFromSettings(savedSettings);
    if (!config.apiKey && active && active.hasApiKey && active.provider === config.provider && active.model === config.model) {
      config.profileId = active.id;
    }
    if (!config.apiKey && setupMode === "cloud") {
      const savedProfile = savedCloudProfileFor(config.provider);
      if (profileHasApiKey(savedProfile)) {
        config.profileId = savedProfile.id;
        if (!config.baseUrl && savedProfile.baseUrl) config.baseUrl = savedProfile.baseUrl;
      }
    }
    return config;
  };

  const savedModelChoiceComplete = (saved, ollamaStatus, ollamaModels, savedDockerModels) => {
    const active = activeProfileFromSettings(saved);
    if (!active || !active.provider || !active.model) return false;
    if (active.provider === "ollama") {
      return !!(ollamaStatus && ollamaStatus.installed && ollamaStatus.running && (ollamaModels || []).includes(active.model));
    }
    if (isDockerModelRunnerSettings(active)) {
      return !!(active.baseUrl && (savedDockerModels || []).includes(active.model));
    }
    if (isLmStudioSettings(active)) {
      return !!(active.baseUrl && active.model);
    }
    if (active.provider === "openai-compatible") {
      return !!(active.baseUrl && (active.apiKey || active.hasApiKey || isHostedSetup));
    }
    return !!(active.apiKey || active.hasApiKey);
  };

  const refresh = async (options) => {
    if (isHostedSetup) {
      try {
        const res = await fetch("/api/provider-settings", { headers: { Accept: "application/json" } });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error((json && json.error) || "Could not load hosted provider settings.");
        const saved = json && json.settings ? json.settings : { profiles: [], defaultProfileId: null, taskDefaults: {} };
        setSavedSettings(saved);
        setTaskDefaults(saved.taskDefaults || {});
        const activeSaved = activeProfileFromSettings(saved);
        if (activeSaved && activeSaved.provider) {
          setSetupSource("cloud");
          setSetupMode("cloud");
          setCloudProvider(activeSaved.provider);
        } else {
          setSetupSource("cloud");
          setSetupMode("cloud");
        }
        if (activeSaved && activeSaved.baseUrl) setCloudBaseUrl(activeSaved.baseUrl);
        if (activeSaved && activeSaved.model) {
          setModel(activeSaved.model);
          setProfileName(activeSaved.label || providerLabel(activeSaved.provider) + " " + activeSaved.model);
        }
        if (options && options.syncSetupOpen) {
          if (savedModelChoiceComplete(saved, null, [], [])) {
            window.localStorage.setItem(setupCompleteKey, "true");
            setOpen(false);
          } else if (window.localStorage.getItem(setupCompleteKey) !== "true") {
            setOpen(true);
          }
        }
        setMessage("");
        return saved;
      } catch (e) {
        setMessage((e && e.message) || "Hosted provider setup check failed.");
        if (options && options.syncSetupOpen && window.localStorage.getItem(setupCompleteKey) !== "true") setOpen(true);
        return null;
      }
    }
    if (!isDesktopSetup) return;
    try {
      await desktop.initLocalDatabase().catch(() => null);
      const [s, list, saved] = await Promise.all([
        desktop.ollamaStatus().catch((e) => ({ installed: false, running: false, message: e.message })),
        desktop.listOllamaModels().catch(() => []),
        desktop.getModelChoice().catch(() => null),
      ]);
      setStatus(s);
      const localModels = preferGemma(list || []);
      setModels(localModels);
      let savedDockerModels = [];
      const activeSaved = activeProfileFromSettings(saved);
      if (isDockerModelRunnerSettings(activeSaved)) {
        savedDockerModels = await fetchOpenAICompatibleModels(activeSaved.baseUrl).catch(() => []);
        setDockerModels(savedDockerModels);
      }
      const hasSavedModelChoice = savedModelChoiceComplete(saved, s, localModels, savedDockerModels);
      setSavedSettings(saved);
      setTaskDefaults((saved && saved.taskDefaults) || {});
      if (activeSaved && activeSaved.provider) {
        if (activeSaved.provider === "ollama") {
          setSetupSource("local");
          setSetupMode("ollama");
        }
        else if (isDockerModelRunnerSettings(activeSaved)) {
          setSetupSource("local");
          setSetupMode("docker");
        }
        else if (isLmStudioSettings(activeSaved)) {
          setSetupSource("local");
          setSetupMode("lmstudio");
        }
        else {
          setSetupSource("cloud");
          setSetupMode("cloud");
          setCloudProvider(activeSaved.provider);
        }
      }
      if (activeSaved && activeSaved.baseUrl) {
        if (activeSaved.provider === "openai-compatible" && activeSaved.baseUrl.includes("12434")) setDockerBaseUrl(activeSaved.baseUrl);
        else if (activeSaved.provider === "openai-compatible" && activeSaved.baseUrl.includes("1234")) setLmStudioBaseUrl(activeSaved.baseUrl);
        else setCloudBaseUrl(activeSaved.baseUrl);
      }
      if (activeSaved && activeSaved.apiKey) setApiKey(activeSaved.apiKey);
      if (activeSaved && activeSaved.model) {
        setModel(activeSaved.model);
        setProfileName(activeSaved.label || providerLabel(activeSaved.provider) + " " + activeSaved.model);
      }
      else if (localModels.length) setModel(localModels[0]);
      if (options && options.syncSetupOpen) {
        if (hasSavedModelChoice) {
          window.localStorage.setItem(setupCompleteKey, "true");
          setOpen(false);
        } else {
          window.localStorage.removeItem(setupCompleteKey);
          setOpen(true);
        }
      }
      setMessage("");
      return saved;
    } catch (e) {
      setMessage((e && e.message) || "Desktop setup check failed.");
      if (options && options.syncSetupOpen && window.localStorage.getItem(setupCompleteKey) !== "true") setOpen(true);
      return null;
    }
  };

  const withoutEmptyOptionals = (value) => {
    if (Array.isArray(value)) return value.map(withoutEmptyOptionals).filter((item) => item !== undefined);
    if (value && typeof value === "object") {
      const out = {};
      Object.entries(value).forEach(([key, child]) => {
        const cleaned = withoutEmptyOptionals(child);
        if (cleaned !== undefined && cleaned !== "") out[key] = cleaned;
      });
      return out;
    }
    return value === undefined ? undefined : value;
  };

  const mediaProfileIdFor = (profile) =>
    String(["media", profile.provider, profile.baseUrl || "", profile.model || ""].join("-"))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "media-profile";

  const saveHostedOpenAIMediaProfile = async (key) => {
    if (!key) return;
    const profile = {
      id: mediaProfileIdFor({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini-tts" }),
      label: "OpenAI media and voice",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      baseUrl: "https://api.openai.com/v1",
      apiKey: key,
    };
    const current = await fetch("/api/media/provider-settings", { headers: { Accept: "application/json" } })
      .then((res) => res.ok ? res.json() : null)
      .catch(() => null);
    const currentSettings = current && current.settings ? current.settings : { profiles: [], defaultProfileId: null };
    const existing = Array.isArray(currentSettings.profiles) ? currentSettings.profiles : [];
    const profiles = existing.filter((item) => item.id !== profile.id).concat(profile);
    const res = await fetch("/api/media/provider-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ settings: { profiles, defaultProfileId: profile.id } }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error((json && json.error) || "Could not save hosted media provider settings.");
  };

  const pullModel = async () => {
    if (!model.trim()) return;
    setBusy(true); setMessage("Downloading " + model + ". This can take a while.");
    try {
      await desktop.pullOllamaModel(model.trim());
      await refreshLocalSetup("ollama");
      setMessage("Model is ready.");
    } catch (e) {
      setMessage((e && e.message) || "Could not download the model.");
    }
    setBusy(false);
  };

  const startOllama = async () => {
    setBusy(true); setMessage("Starting Ollama.");
    try {
      await desktop.startOllama();
      await refreshLocalSetup("ollama");
      setMessage("Ollama is running.");
    } catch (e) {
      setMessage((e && e.message) || "Could not start Ollama.");
    }
    setBusy(false);
  };

  const openOllamaDownload = async () => {
    setBusy(true); setMessage("Opening the Ollama installer page.");
    try {
      await desktop.openOllamaDownload();
      setMessage("Install Ollama, then click Check again.");
    } catch (e) {
      setMessage((e && e.message) || "Could not open the Ollama download page.");
    }
    setBusy(false);
  };

  const checkAgain = async () => {
    setBusy(true); setMessage("Checking local model setup.");
    try {
      await refreshLocalSetup(setupMode);
      setMessage("Setup status updated.");
    } catch (e) {
      setMessage((e && e.message) || "Could not refresh setup status.");
    }
    setBusy(false);
  };

  const refreshLocalSetup = async (nextMode) => {
    if (!isDesktopSetup) return;
    const [s, list] = await Promise.all([
      desktop.ollamaStatus().catch((e) => ({ installed: false, running: false, message: e.message })),
      desktop.listOllamaModels().catch(() => []),
    ]);
    const localModels = preferGemma(list || []);
    setStatus(s);
    setModels(localModels);
    if ((nextMode || setupMode) === "ollama" && localModels.length && (!model.trim() || !localModels.includes(model.trim()))) {
      setModel(localModels[0]);
    }
  };

  const refreshOllamaModels = async () => {
    setBusy(true); setMessage("Refreshing Ollama models.");
    try {
      await refreshLocalSetup("ollama");
      const localModels = preferGemma(await desktop.listOllamaModels().catch(() => []));
      if (localModels.length && (!model.trim() || !localModels.includes(model.trim()))) setModel(localModels[0]);
      setMessage(localModels.length ? "Loaded " + localModels.length + " Ollama model" + (localModels.length === 1 ? "" : "s") + "." : "Ollama responded, but no local chat models were listed.");
    } catch (e) {
      setMessage((e && e.message) || "Could not refresh Ollama models.");
    }
    setBusy(false);
  };

  const listDockerModels = async () => {
    setBusy(true); setMessage("Checking Docker Model Runner.");
    try {
      const listed = await fetchOpenAICompatibleModels(dockerBaseUrl);
      setDockerModels(listed);
      if (listed.length) setModel(listed[0]);
      setProfileName("");
      setMessage(listed.length ? "Docker models loaded." : "Docker Model Runner responded, but no models were listed.");
    } catch (e) {
      setDockerModels([]);
      setMessage((e && e.message) || "Could not reach Docker Model Runner.");
    }
    setBusy(false);
  };

  const listLocalCompatibleModels = async (kind) => {
    const selected = kind || setupMode;
    const label = selected === "lmstudio" ? "LM Studio" : "Docker Model Runner";
    const baseUrl = selected === "lmstudio" ? lmStudioBaseUrl : dockerBaseUrl;
    setBusy(true); setMessage("Detecting models from " + label + ".");
    try {
      const listed = modelOptionsFor("openai-compatible", await fetchOpenAICompatibleModels(baseUrl));
      setLocalCompatibleModels(listed);
      if (selected === "docker") setDockerModels(listed);
      if (listed.length) setModel(listed[0]);
      setMessage(listed.length ? label + " models detected." : label + " responded, but no usable writing models were listed.");
    } catch (e) {
      setLocalCompatibleModels([]);
      setMessage((e && e.message) || ("Could not reach " + label + "."));
    }
    setBusy(false);
  };

  const listCloudModels = async () => {
    const config = currentProviderConfig();
    setBusy(true); setMessage("Listing models from " + providerLabel(config.provider) + ".");
    try {
      const canUseSavedDesktopKey = !isHostedSetup && (config.provider === "openai" || config.provider === "xai");
      if (config.provider === "openai-compatible" && !config.baseUrl) throw new Error("Add a base URL first.");
      if (!canUseSavedDesktopKey && config.provider !== "openai-compatible" && config.provider !== "ollama" && !config.apiKey && !config.profileId) throw new Error("Add an API key first.");
      const res = await fetch("/api/llm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || "Could not list models.");
      const listed = modelOptionsFor(config.provider, json && Array.isArray(json.models) ? json.models : []);
      setCloudListedModels((current) => Object.assign({}, current, { [config.provider]: listed }));
      if (listed.length) {
        const fallback = defaultModelFor(config.provider);
        setModel(listed.includes(fallback) ? fallback : listed[0]);
        setMessage((json && json.warning) || ("Loaded " + listed.length + " model" + (listed.length === 1 ? "" : "s") + "."));
      } else {
        setModel(defaultModelFor(config.provider));
        setMessage((json && json.warning) || "Provider responded, but no usable writing models were listed.");
      }
    } catch (e) {
      setCloudListedModels((current) => Object.assign({}, current, { [config.provider]: [] }));
      setModel(defaultModelFor(config.provider));
      setMessage((e && e.message) || "Could not detect models.");
    }
    setBusy(false);
  };

  const testModel = async () => {
    const config = currentProviderConfig();
    if (!config.model) {
      setMessage("Choose or type a model before testing.");
      return;
    }
    setBusy(true); setMessage("Testing " + providerLabel(config.provider) + " " + config.model + ".");
    try {
      const res = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error((json && json.error) || "The model test failed.");
      setMessage("Test passed for " + providerLabel(config.provider) + " " + config.model + ".");
    } catch (e) {
      setMessage((e && e.message) || "The model test failed.");
    }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true);
    try {
      const picked = model.trim();
      if (!picked) throw new Error("Choose a model first.");
      let nextProfile = null;
      if (setupMode === "ollama") {
        if (!installed || !running || !models.includes(picked)) throw new Error("Install or start Ollama, then pull the selected model.");
        nextProfile = { provider: "ollama", model: picked, baseUrl: "http://127.0.0.1:11434" };
      } else if (setupMode === "docker" || setupMode === "lmstudio") {
        const localBaseUrl = setupMode === "lmstudio"
          ? (lmStudioBaseUrl.trim() || "http://127.0.0.1:1234/v1")
          : (dockerBaseUrl.trim() || "http://localhost:12434/engines/v1");
        if (!localBaseUrl.trim()) throw new Error("Add the local server URL.");
        nextProfile = {
          provider: "openai-compatible",
          model: picked,
          baseUrl: localBaseUrl,
        };
      } else {
        const key = usableApiKey();
        const savedProfile = savedCloudProfileFor(cloudProvider);
        const canUseSavedDesktopKey = !isHostedSetup && (cloudProvider === "openai" || cloudProvider === "xai");
        if (!key && !canUseSavedDesktopKey && !profileHasApiKey(savedProfile)) throw new Error("Add an API key for the selected cloud provider.");
        nextProfile = {
          provider: cloudProvider,
          model: picked,
          baseUrl: cloudProvider === "openai-compatible" ? (cloudBaseUrl.trim() || (savedProfile && savedProfile.baseUrl) || "") : undefined,
          apiKey: key || (savedProfile && savedProfile.apiKey),
        };
      }
      if (nextProfile.provider !== "ollama") {
        setMessage("Verifying " + providerLabel(nextProfile.provider) + " " + picked + ".");
        const testConfig = {
          provider: nextProfile.provider,
          model: nextProfile.model,
          baseUrl: nextProfile.baseUrl,
          apiKey: isSavedSecret(nextProfile.apiKey) ? undefined : nextProfile.apiKey,
        };
        const res = await fetch("/api/llm/test", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(testConfig),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error((json && json.error) || "The model could not be verified.");
      }
      nextProfile.id = profileIdFor(nextProfile);
      nextProfile.label = providerLabel(nextProfile.provider) + " " + nextProfile.model;
      const priorProfiles = profilesFromSettings(savedSettings);
      const profiles = priorProfiles.filter((p) => p.id !== nextProfile.id).concat(nextProfile);
      const priorDefaultId = savedSettings && savedSettings.defaultProfileId;
      const currentTaskDefaults = taskDefaults || {};
      const nextTaskDefaults = Object.fromEntries(taskOptions.map((task) => {
        const current = currentTaskDefaults[task.id];
        return [task.id, (!current || current === priorDefaultId) ? nextProfile.id : current];
      }));
      const nextSettings = {
        provider: nextProfile.provider,
        model: nextProfile.model,
        baseUrl: nextProfile.baseUrl,
        apiKey: nextProfile.apiKey,
        profiles,
        defaultProfileId: nextProfile.id,
        taskDefaults: nextTaskDefaults,
      };
      const cleanedSettings = withoutEmptyOptionals(nextSettings);
      let savedResponse = cleanedSettings;
      if (isHostedSetup) {
        const res = await fetch("/api/provider-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ settings: cleanedSettings }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error((json && json.error) || "Could not save hosted provider settings.");
        savedResponse = json.settings || cleanedSettings;
      } else {
        await desktop.saveLLMSettings(cleanedSettings);
      }
      if (nextProfile.provider === "openai" && nextProfile.apiKey) {
        if (isHostedSetup) {
          await saveHostedOpenAIMediaProfile(nextProfile.apiKey);
        } else if (desktop.saveMediaProviderKey) {
          await desktop.saveMediaProviderKey("openai", nextProfile.apiKey, { baseUrl: "https://api.openai.com/v1" });
        }
      }
      setSavedSettings(savedResponse);
      setTaskDefaults(nextTaskDefaults);
      window.localStorage.setItem(setupCompleteKey, "true");
      window.dispatchEvent(new CustomEvent("pillarpress:llm-settings-changed", { detail: { profileId: nextProfile.id, context: modelSetupContext } }));
      window.dispatchEvent(new CustomEvent("pillarpress:llm-profile-selected", { detail: { profileId: nextProfile.id, context: modelSetupContext } }));
      notifyModelSetupSaved(savedResponse, nextProfile);
      setModelSetupContext(null);
      setOpen(false);
    } catch (e) {
      setMessage((e && e.message) || (typeof e === "string" ? e : "Could not save the model choice."));
    }
    setBusy(false);
  };

  const saveTaskDefaults = async () => {
    const profiles = profilesFromSettings(savedSettings);
    if (!profiles.length) return;
    setBusy(true);
    try {
      const defaultProfile = activeProfileFromSettings(savedSettings) || profiles[0];
      const nextSettings = {
        ...(savedSettings || {}),
        provider: defaultProfile.provider,
        model: defaultProfile.model,
        baseUrl: defaultProfile.baseUrl,
        apiKey: defaultProfile.apiKey,
        profiles,
        defaultProfileId: (savedSettings && savedSettings.defaultProfileId) || defaultProfile.id,
        taskDefaults,
      };
      const cleanedSettings = withoutEmptyOptionals(nextSettings);
      if (isHostedSetup) {
        const res = await fetch("/api/provider-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ settings: cleanedSettings }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error((json && json.error) || "Could not save hosted task defaults.");
        setSavedSettings(json.settings || cleanedSettings);
      } else {
        await desktop.saveLLMSettings(cleanedSettings);
        setSavedSettings(cleanedSettings);
      }
      setMessage("Task defaults saved.");
    } catch (e) {
      setMessage((e && e.message) || (typeof e === "string" ? e : "Could not save task defaults."));
    }
    setBusy(false);
  };

  React.useEffect(() => {
    if (!open) return undefined;
    if (setupMode === "cloud") {
      const savedProfile = savedCloudProfileFor(cloudProvider);
      const ready = (!!usableApiKey() || profileHasApiKey(savedProfile) || (!isHostedSetup && (cloudProvider === "openai" || cloudProvider === "xai"))) &&
        (cloudProvider !== "openai-compatible" || !!cloudBaseUrl.trim() || !!(savedProfile && savedProfile.baseUrl));
      if (!ready) {
        setCloudListedModels((current) => Object.assign({}, current, { [cloudProvider]: [] }));
        setModel(defaultModelFor(cloudProvider));
        return undefined;
      }
      const timer = window.setTimeout(() => { listCloudModels(); }, 650);
      return () => window.clearTimeout(timer);
    }
    if (setupMode === "docker" || setupMode === "lmstudio") {
      const ready = setupMode === "lmstudio" ? !!lmStudioBaseUrl.trim() : !!dockerBaseUrl.trim();
      if (!ready) return undefined;
      const timer = window.setTimeout(() => { listLocalCompatibleModels(setupMode); }, 650);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open, setupMode, cloudProvider, apiKey, cloudBaseUrl, dockerBaseUrl, lmStudioBaseUrl, savedSettings]);

  React.useEffect(() => {
    if (!open || !modelSetupRef.current) return;
    setTimeout(() => {
      if (modelSetupRef.current) modelSetupRef.current.focus();
    }, 0);
  }, [open]);

  if (!open) return null;
  const installed = !!(status && status.installed);
  const running = !!(status && status.running);
  const hasModel = models.includes(model);
  const visibleModelOptions = modelOptionsForSetup();
  const modelSource = isHostedSetup ? "cloud" : setupSource;
  const activeProviderId = modelSource === "cloud" ? cloudProvider : setupMode;
  const activeSavedCloudProfile = setupMode === "cloud" ? savedCloudProfileFor(cloudProvider) : null;
  const hasCloudCredential = setupMode !== "cloud" || (!!usableApiKey() || profileHasApiKey(activeSavedCloudProfile) || (!isHostedSetup && (cloudProvider === "openai" || cloudProvider === "xai")));
  const hasCloudBaseUrl = setupMode !== "cloud" || cloudProvider !== "openai-compatible" || !!cloudBaseUrl.trim() || !!(activeSavedCloudProfile && activeSavedCloudProfile.baseUrl);
  const selectedProviderLabel = setupMode === "cloud"
    ? providerLabel(cloudProvider)
    : setupMode === "lmstudio"
      ? "LM Studio"
      : setupMode === "docker"
        ? "Docker Model Runner"
        : "Ollama";
  const canUseModel = setupMode === "ollama"
    ? installed && running && hasModel && !!model.trim()
    : (setupMode === "docker" || setupMode === "lmstudio")
      ? !!model.trim() && visibleModelOptions.includes(model) && !!(setupMode === "lmstudio" ? lmStudioBaseUrl.trim() : dockerBaseUrl.trim())
      : !!model.trim() && hasCloudCredential && hasCloudBaseUrl;
  const savedProfiles = profilesFromSettings(savedSettings);
  const taskGroups = [
    { label: "Desk & research", tasks: ["utility", "gather", "weave"] },
    { label: "Writing pipeline", tasks: ["draft", "review", "revision", "outputs"] },
    { label: "Utilities", tasks: ["mediaPrompt", "file"] },
  ];
  const taskById = Object.fromEntries(taskOptions.map((task) => [task.id, task]));

  return (
    <div
      ref={modelSetupRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kp-model-setup-title"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") closeModelSetup(); }}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--paper)", display: "flex", flexDirection: "column", outline: "none" }}
    >
      <div style={{ padding: "28px clamp(20px, 4vw, 56px) 22px", borderBottom: "1px solid var(--hair)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexShrink: 0 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{isHostedSetup ? "Pillar Press hosted setup" : "Pillar Press desktop setup"}</div>
          <h2 id="kp-model-setup-title" style={{ fontSize: 30, marginBottom: 10 }}>Choose your writing model</h2>
          <p className="muted" style={{ fontSize: 15.5, lineHeight: 1.55, maxWidth: 760 }}>
            {isHostedSetup
              ? "Save a provider key encrypted on the server, then use it for hosted Pillar Press workflows without pasting it again."
              : "Pillar Press keeps your editorial database local. Use a local model by default, or add a cloud API key when you want hosted compute."}
          </p>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.45, maxWidth: 760 }}>
            Setup order: choose a provider, list or pull a model, test it, then use it for your writing defaults.
          </p>
        </div>
        <button className="icon-btn" onClick={closeModelSetup} title="Close setup"><Icon name="xLogo" size={15} /></button>
      </div>
      <div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: "28px clamp(20px, 4vw, 56px) 40px" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          {!isHostedSetup && (
            <div style={{ display: "inline-flex", gap: 4, padding: 4, border: "1px solid var(--hair)", borderRadius: 999, background: "var(--paper-sunk)", marginBottom: 20 }}>
              {["cloud", "local"].map((source) => (
                <button
                  key={source}
                  className="mono"
                  onClick={() => {
                    if (source === "cloud") {
                      setSetupSource("cloud");
                      setSetupMode("cloud");
                      setModel(defaultModelFor(cloudProvider));
                    } else {
                      setSetupSource("local");
                      setSetupMode("ollama");
                      setModel(pickDetectedModel(models, ""));
                      refreshLocalSetup("ollama").catch((e) => setMessage((e && e.message) || "Could not refresh local models."));
                    }
                    if (source === "cloud") setMessage("");
                  }}
                  style={{ border: "none", borderRadius: 999, padding: "8px 18px", cursor: "pointer", fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase", background: modelSource === source ? "var(--accent)" : "transparent", color: modelSource === source ? "white" : "var(--ink-2)" }}
                >
                  {source}
                </button>
              ))}
            </div>
          )}

          {modelSource === "cloud" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12 }}>
              {cloudProviderOptions.map((option) => {
                const active = activeProviderId === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      const savedProfile = savedCloudProfileFor(option.id);
                      setSetupSource("cloud");
                      setSetupMode("cloud");
                      setCloudProvider(option.id);
                      setCloudBaseUrl(option.id === "openai-compatible" ? ((savedProfile && savedProfile.baseUrl) || cloudBaseUrl) : "");
                      setApiKey((savedProfile && savedProfile.apiKey) || "");
                      const listed = cloudListedModels[option.id] || [];
                      setModel((savedProfile && savedProfile.model) || (listed.includes(defaultModelFor(option.id)) ? defaultModelFor(option.id) : listed[0]) || defaultModelFor(option.id));
                      setMessage("");
                    }}
                    style={{ minHeight: 156, textAlign: "left", display: "grid", gridTemplateColumns: "44px 1fr", gap: 14, alignItems: "start", padding: 18, borderRadius: 8, border: "1.5px solid " + (active ? "var(--accent)" : "var(--hair)"), background: active ? "var(--accent-soft)" : "var(--paper-2)", color: "var(--ink)", cursor: "pointer", boxShadow: active ? "0 14px 40px rgba(125, 46, 46, 0.10)" : "none" }}
                  >
                    <span style={{ width: 42, height: 42, display: "grid", placeItems: "center" }}>
                      <img src={option.logoSrc} alt="" style={{ maxWidth: 38, maxHeight: 38, objectFit: "contain" }} />
                    </span>
                    <span style={{ display: "grid", gap: 5 }}>
                      <strong style={{ fontSize: 22, lineHeight: 1 }}>{option.name}</strong>
                      <em style={{ fontStyle: "normal", color: "var(--accent-ink)", fontSize: 14 }}>{option.label}</em>
                      <span style={{ color: "var(--muted)", fontSize: 14.5, lineHeight: 1.35 }}>{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {modelSource === "local" && !isHostedSetup && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
              {localProviderOptions.map((option) => {
                const active = activeProviderId === option.id;
                const statusText = option.id === "ollama"
                  ? installed ? (running ? ((models.length || 0) + " model" + (models.length === 1 ? "" : "s") + " detected") : "Installed, not running") : "Not detected"
                  : active && localCompatibleModels.length
                    ? (localCompatibleModels.length + " model" + (localCompatibleModels.length === 1 ? "" : "s") + " detected")
                    : option.id === "lmstudio" ? "Detects from LM Studio" : "Detects from Docker Desktop";
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      if (option.id === "ollama") {
                        setSetupSource("local");
                        setSetupMode("ollama");
                        setModel(pickDetectedModel(models, ""));
                        refreshLocalSetup("ollama").catch((e) => setMessage((e && e.message) || "Could not refresh Ollama models."));
                      } else {
                        setSetupSource("local");
                        setSetupMode(option.id);
                        setLocalCompatibleModels([]);
                        if (option.id === "lmstudio") setLmStudioBaseUrl(lmStudioBaseUrl || "http://127.0.0.1:1234/v1");
                        else setDockerBaseUrl(dockerBaseUrl || "http://localhost:12434/engines/v1");
                        setModel("");
                        listLocalCompatibleModels(option.id);
                      }
                    }}
                    style={{ minHeight: 150, textAlign: "left", display: "grid", gridTemplateColumns: "44px 1fr", gap: 14, alignItems: "start", padding: 18, borderRadius: 8, border: "1.5px solid " + (active ? "var(--accent)" : "var(--hair)"), background: active ? "var(--accent-soft)" : "var(--paper-2)", color: "var(--ink)", cursor: "pointer" }}
                  >
                    <span style={{ width: 42, height: 42, display: "grid", placeItems: "center" }}>
                      <img src={option.logoSrc} alt="" style={{ maxWidth: 38, maxHeight: 38, objectFit: "contain" }} />
                    </span>
                    <span style={{ display: "grid", gap: 5 }}>
                      <strong style={{ fontSize: 21, lineHeight: 1 }}>{option.name}</strong>
                      <em style={{ fontStyle: "normal", color: "var(--accent-ink)", fontSize: 14 }}>{statusText}</em>
                      <span style={{ color: "var(--muted)", fontSize: 14.5, lineHeight: 1.35 }}>{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="card" style={{ marginTop: 18, padding: 18, borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 5 }}>{selectedProviderLabel}</div>
                <h3 style={{ margin: 0, fontSize: 22 }}>Writing model setup</h3>
              </div>
              <button className="btn ghost sm" disabled={busy} onClick={setupMode === "ollama" ? checkAgain : (setupMode === "docker" || setupMode === "lmstudio") ? () => listLocalCompatibleModels(setupMode) : listCloudModels}>
                <Icon name="check" size={13} /> Refresh
              </button>
            </div>
            {setupMode === "cloud" && (
              <div style={{ display: "grid", gridTemplateColumns: cloudProvider === "openai-compatible" ? "1fr 1fr" : "1fr", gap: 10, marginBottom: 12 }}>
                <label>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>{providerLabel(cloudProvider)} API key</span>
                  <input className="field" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={profileHasApiKey(activeSavedCloudProfile) ? "Saved API key" : "Paste your API key"} />
                </label>
                {cloudProvider === "openai-compatible" && (
                  <label>
                    <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Base URL</span>
                    <input className="field" value={cloudBaseUrl} onChange={(e) => setCloudBaseUrl(e.target.value)} placeholder="https://provider.example/v1" />
                  </label>
                )}
              </div>
            )}
            {(setupMode === "docker" || setupMode === "lmstudio") && (
              <label style={{ display: "block", marginBottom: 12 }}>
                <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>{selectedProviderLabel} URL</span>
                <input className="field" value={setupMode === "lmstudio" ? lmStudioBaseUrl : dockerBaseUrl} onChange={(e) => setupMode === "lmstudio" ? setLmStudioBaseUrl(e.target.value) : setDockerBaseUrl(e.target.value)} />
              </label>
            )}
            {setupMode === "ollama" && !installed && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                <span className="muted" style={{ fontSize: 14.5 }}>Ollama is not installed yet.</span>
                <button className="btn" disabled={busy} onClick={openOllamaDownload}><Icon name="globe" size={14} /> Install Ollama</button>
              </div>
            )}
            {setupMode === "ollama" && installed && !running && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                <span className="muted" style={{ fontSize: 14.5 }}>Ollama is installed but not running.</span>
                <button className="btn" disabled={busy} onClick={startOllama}><Icon name="play" size={14} /> Start Ollama</button>
              </div>
            )}
            <label>
              <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Model</span>
              <select className="field" value={visibleModelOptions.includes(model) ? model : ""} onChange={(e) => setModel(e.target.value)} disabled={setupMode === "cloud" ? !hasCloudCredential || !hasCloudBaseUrl : !visibleModelOptions.length}>
                <option value="">{setupMode === "cloud" ? (hasCloudCredential && hasCloudBaseUrl ? "Select a model" : "Add credentials to detect models") : visibleModelOptions.length ? ("Select a " + selectedProviderLabel + " model") : ("No " + selectedProviderLabel + " models detected")}</option>
                {visibleModelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn primary" disabled={busy || !canUseModel} onClick={finish}>{busy ? <><Spinner size={14} /> Working</> : "Use model"}</button>
            </div>
          </div>

          {!!savedProfiles.length && (
            <div className="card" style={{ marginTop: 18, padding: 18, borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 5 }}>Task defaults</div>
                  <h3 style={{ margin: 0, fontSize: 22 }}>Route each workflow to the right model</h3>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 14.5, lineHeight: 1.45 }}>Most people can leave everything on the default profile. Split tasks only when you want local research and cloud drafting.</p>
                </div>
                <button className="btn sm" disabled={busy} onClick={saveTaskDefaults}><Icon name="check" size={14} /> Save defaults</button>
              </div>
              <div style={{ display: "grid", gap: 14 }}>
                {taskGroups.map((group) => (
                  <section key={group.label}>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>{group.label}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                      {group.tasks.map((taskId) => {
                        const task = taskById[taskId];
                        const selected = taskDefaults[taskId] || (savedSettings && savedSettings.defaultProfileId) || savedProfiles[0].id;
                        return (
                          <div key={taskId} style={{ border: "1px solid var(--hair)", borderRadius: 8, padding: 12, background: "var(--paper-sunk)" }}>
                            <div style={{ fontSize: 15.5, fontWeight: 650, marginBottom: 9 }}>{task.label}</div>
                            <div style={{ display: "grid", gap: 6 }}>
                              {savedProfiles.map((profile) => {
                                const active = selected === profile.id;
                                return (
                                  <button
                                    key={profile.id}
                                    onClick={() => setTaskDefaults({ ...taskDefaults, [taskId]: profile.id })}
                                    style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderRadius: 7, border: "1px solid " + (active ? "var(--accent)" : "var(--hair)"), background: active ? "var(--accent-soft)" : "var(--paper-2)", color: active ? "var(--accent-ink)" : "var(--ink)", padding: "8px 10px", cursor: "pointer", textAlign: "left" }}
                                  >
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.label || providerLabel(profile.provider)}</span>
                                    <span className="mono" style={{ fontSize: 10.5, color: active ? "var(--accent-ink)" : "var(--ink-3)" }}>{profile.model}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
          {message && <p style={{ marginTop: 12, color: "var(--accent-ink)", fontSize: 14 }}>{message}</p>}
        </div>
      </div>
    </div>
  );
}

function BillingPanel({ open, onClose, billing, notice }) {
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");

  if (!open) return null;

  const subscription = billing && billing.subscription;
  const lifecycle = (billing && billing.lifecycle) || null;
  const trial = lifecycle && lifecycle.trial ? lifecycle.trial : null;
  const plans = (billing && billing.plans) || [];
  const usage = billing && billing.usage;
  const dims = usage && usage.dimensions ? usage.dimensions : {};
  const planId = (lifecycle && lifecycle.planId) || (subscription && subscription.planId);
  const status = (lifecycle && lifecycle.status) || (subscription && subscription.status) || "trialing";
  const portalManagedStatuses = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);
  const hasPortalManagedPaidSubscription = Boolean(planId && planId !== "trial" && portalManagedStatuses.has(status));
  const planLabel = (plans.find((p) => p.id === planId) || { name: planId === "trial" ? "Free Trial" : "Current plan" }).name;
  const accessNotice =
    notice ||
    (billing && billing.access && billing.access.allowed === false
      ? { code: billing.access.code, error: billing.access.message }
      : null);
  const lifecycleNotice = !accessNotice && trial && (trial.expired || trial.endsSoon)
    ? {
        title: trial.expired ? "Trial ended" : "Trial ending soon",
        message: trial.expired
          ? "Your free trial has ended. Choose a plan to keep publishing."
          : "Your trial ends in " + trial.daysRemaining + " " + (trial.daysRemaining === 1 ? "day" : "days") + ". Choose a plan now so work does not pause.",
      }
    : null;

  const money = (cents, currency) => {
    if (!cents) return "Free";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "usd", maximumFractionDigits: 0 }).format(cents / 100) + "/mo";
    } catch {
      return "$" + Math.round(cents / 100) + "/mo";
    }
  };
  const dateLabel = (value) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };
  const pct = (used, limit) => !limit ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const dimensionLabel = { llm: "AI credits", gather: "Gather runs", media: "Media generations", storage: "Storage" };
  const formatUsageValue = (key, value) => {
    if (key !== "storage") return value;
    const gb = value / (1024 * 1024 * 1024);
    if (gb >= 1) return gb.toFixed(gb >= 10 ? 0 : 1) + " GB";
    const mb = value / (1024 * 1024);
    return Math.max(0, Math.round(mb)) + " MB";
  };
  const noticeTitle =
    accessNotice && accessNotice.code === "subscription_required" ? "Subscription required" :
    accessNotice && accessNotice.code === "trial_expired" ? "Trial ended" :
    accessNotice && accessNotice.code === "subscription_inactive" ? "Billing needs attention" :
    accessNotice && accessNotice.code === "campaign_limit_exceeded" ? "Campaign limit reached" :
    accessNotice && accessNotice.code === "concurrent_job_limit_exceeded" ? "Concurrent job limit reached" :
    accessNotice && accessNotice.code === "drive_not_enabled" ? "Drive requires an upgrade" :
    accessNotice && accessNotice.code === "managed_provider_not_enabled" ? "Managed AI requires an upgrade" :
    accessNotice && accessNotice.code === "byok_provider_not_enabled" ? "BYOK providers require an upgrade" :
    accessNotice && accessNotice.code === "export_not_enabled" ? "Exports require an upgrade" :
    accessNotice && accessNotice.code === "storage_quota_exceeded" ? "Storage limit reached" :
    "Usage limit reached";

  const refresh = async () => {
    setBusy("refresh");
    setError("");
    try { await window.Store.refreshBilling(); }
    catch (e) { setError((e && e.message) || "Could not refresh billing."); }
    setBusy("");
  };
  const checkout = async (plan) => {
    setBusy("checkout-" + plan.id);
    setError("");
    try { await window.Store.startCheckout(plan.id); }
    catch (e) {
      if (e && e.code === "billing_portal_required") {
        setError("Use Manage billing to change your current plan.");
      } else {
        setError((e && e.message) || "Could not start checkout.");
      }
      setBusy("");
    }
  };
  const portal = async () => {
    setBusy("portal");
    setError("");
    try { await window.Store.openBillingPortal(); }
    catch (e) { setError((e && e.message) || "Could not open billing portal."); setBusy(""); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Billing and usage" style={{
      position: "fixed", inset: 0, zIndex: 220, background: "oklch(0 0 0 / 0.32)",
      display: "grid", placeItems: "center", padding: 20,
    }}>
      <div style={{
        width: "min(760px, 100%)", maxHeight: "min(760px, calc(100vh - 40px))",
        overflow: "auto", border: "1px solid var(--hair)", borderRadius: 16,
        background: "var(--paper-2)", boxShadow: "var(--shadow-lg)",
      }}>
        <div style={{ padding: 22, borderBottom: "1px solid var(--hair)", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Account</div>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 500 }}>Billing and usage</h2>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
              {planLabel} · {status}
              {trial && trial.endsAt ? " · " + (trial.expired ? "trial ended " : "trial ends ") + dateLabel(trial.endsAt) : ""}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close billing"><Icon name="xLogo" size={14} /></button>
        </div>

        <div style={{ padding: 22, display: "grid", gap: 18 }}>
          {accessNotice && (
            <div role="status" style={{
              border: "1px solid var(--accent)",
              borderRadius: 12,
              padding: 13,
              background: "color-mix(in oklch, var(--accent) 8%, var(--paper-2))",
            }}>
              <strong>{noticeTitle}</strong>
              <p style={{ margin: "6px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
                {accessNotice.error || "Upgrade or manage billing to continue this workflow."}
              </p>
            </div>
          )}

          {lifecycleNotice && (
            <div role="status" style={{
              border: "1px solid var(--accent)",
              borderRadius: 12,
              padding: 13,
              background: "color-mix(in oklch, var(--accent) 8%, var(--paper-2))",
            }}>
              <strong>{lifecycleNotice.title}</strong>
              <p style={{ margin: "6px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
                {lifecycleNotice.message}
              </p>
            </div>
          )}

          {usage && (
            <section>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 19 }}>This billing period</h3>
                <span className="muted" style={{ fontSize: 13 }}>
                  {dateLabel(usage.periodStart)} - {dateLabel(usage.periodEnd)}
                </span>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {["llm", "gather", "media", "storage"].map((key) => {
                  const row = dims[key] || { used: 0, limit: 0, remaining: 0 };
                  const percent = pct(row.used, row.limit);
                  return (
                    <div key={key} style={{ display: "grid", gap: 5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5 }}>
                        <span>{dimensionLabel[key]}</span>
                        <span className="muted">{formatUsageValue(key, row.used)} / {formatUsageValue(key, row.limit)}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: "var(--paper)", border: "1px solid var(--hair)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: percent + "%", background: "var(--accent)", borderRadius: 999 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <h3 style={{ margin: "0 0 12px", fontSize: 19 }}>{hasPortalManagedPaidSubscription ? "Plans" : "Upgrade"}</h3>
            {hasPortalManagedPaidSubscription && (
              <p className="muted" style={{ margin: "-4px 0 12px", fontSize: 13.5, lineHeight: 1.4 }}>
                Use Stripe Customer Portal to change or cancel your current plan.
              </p>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
              {plans.map((plan) => {
                const isCurrent = plan.id === planId;
                const actionBusy = busy === "checkout-" + plan.id || busy === "portal";
                const label = actionBusy
                  ? null
                  : isCurrent
                    ? "Current plan"
                    : hasPortalManagedPaidSubscription
                      ? "Manage plan"
                      : "Upgrade";
                const action = hasPortalManagedPaidSubscription && !isCurrent ? portal : () => checkout(plan);
                return (
                  <div key={plan.id} style={{ border: "1px solid var(--hair)", borderRadius: 12, padding: 14, background: "var(--paper)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <strong>{plan.name}</strong>
                      <span>{money(plan.monthlyPriceCents, plan.currency)}</span>
                    </div>
                    <p className="muted" style={{ minHeight: 40, margin: "8px 0 14px", fontSize: 13.5, lineHeight: 1.4 }}>{plan.description}</p>
                    <button
                      className={"btn " + (plan.id === "pro" ? "primary" : "")}
                      disabled={busy || isCurrent || !plan.stripeConfigured}
                      onClick={action}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      {actionBusy ? <Spinner size={14} /> : label}
                    </button>
                    {!plan.stripeConfigured && <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>Stripe price not configured yet.</p>}
                  </div>
                );
              })}
            </div>
          </section>

          {error && <p role="alert" style={{ color: "var(--sev-must)", margin: 0 }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <button className="btn ghost" onClick={refresh} disabled={busy}>{busy === "refresh" ? <Spinner size={14} /> : "Refresh"}</button>
            <button className="btn" onClick={portal} disabled={busy}>{busy === "portal" ? <Spinner size={14} /> : "Manage billing"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const DESK_WORKFLOWS = [
  { id: "article", label: "Article", icon: "doc", title: "Untitled article" },
  { id: "book", label: "Book", icon: "book", view: "book" },
  { id: "letter", label: "Letter", icon: "doc", view: "letter" },
  { id: "communication", label: "Other Communication", icon: "doc", title: "Untitled communication" },
  { id: "gather", label: "Gather", icon: "globe", view: "gather" },
];

function DeskWorkflowMenu({ activeView, activeWorkflow, onOpenWorkflow, onOpenDesk }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const deskActive = activeView === "desk" || activeView === "book" || activeView === "gather" || activeView === "letter" || (activeView === "workspace" && !!activeWorkflow);
  const choose = (workflowId) => {
    setOpen(false);
    onOpenWorkflow(workflowId);
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className={deskActive ? "active" : ""}
        onClick={() => setOpen((v) => !v)}
        onDoubleClick={onOpenDesk}
        title="Desk workflows"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
      >
        Desk <Icon name="chevD" size={12} />
      </button>
      {open && (
        <div
          className="card"
          role="menu"
          style={{
            position: "absolute", top: 38, left: 0, width: 238, padding: 6,
            zIndex: 70, boxShadow: "var(--shadow-lg)",
          }}
        >
          <button
            role="menuitem"
            onClick={() => { setOpen(false); onOpenDesk(); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 9,
              border: "none", background: activeView === "desk" ? "var(--accent-soft)" : "transparent",
              cursor: "pointer", borderRadius: "var(--radius)", padding: "9px 10px",
              color: activeView === "desk" ? "var(--accent-ink)" : "var(--ink)",
              fontFamily: "var(--font-body)", fontSize: 15, textAlign: "left",
            }}
          >
            <Icon name="sparkle" size={14} /> Desk
          </button>
          <hr className="rule" style={{ margin: "5px 4px" }} />
          {DESK_WORKFLOWS.map((workflow) => (
            <button
              key={workflow.id}
              role="menuitem"
              onClick={() => choose(workflow.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 9,
                border: "none", background: (activeView === workflow.view || activeWorkflow === workflow.id) ? "var(--accent-soft)" : "transparent",
                cursor: "pointer", borderRadius: "var(--radius)", padding: "9px 10px",
                color: (activeView === workflow.view || activeWorkflow === workflow.id) ? "var(--accent-ink)" : "var(--ink)",
                fontFamily: "var(--font-body)", fontSize: 15, textAlign: "left",
              }}
            >
              <Icon name={workflow.icon} size={14} /> {workflow.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_LAST_CHECKED_KEY = "pillarpress.updateLastCheckedAt";

function formatUpdateCheckedAt(value) {
  if (!value) return "Not checked yet";
  try {
    return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  } catch (_) {
    return "Recently";
  }
}

function formatUpdateBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1) + " MB";
}

function UpdatePanel() {
  const desktop = window.PILLAR_DESKTOP;
  const hasUpdater = !!(desktop && desktop.isDesktop && desktop.isDesktop() && desktop.checkForUpdates);
  const [status, setStatus] = React.useState("idle");
  const [currentVersion, setCurrentVersion] = React.useState("");
  const [lastChecked, setLastChecked] = React.useState(() => Number(localStorage.getItem(UPDATE_LAST_CHECKED_KEY) || 0));
  const [update, setUpdate] = React.useState(null);
  const [message, setMessage] = React.useState("");
  const [progress, setProgress] = React.useState({ downloaded: 0, total: 0 });

  React.useEffect(() => {
    if (!hasUpdater || !desktop.appVersion) return undefined;
    let cancelled = false;
    desktop.appVersion()
      .then((version) => { if (!cancelled) setCurrentVersion(version || ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hasUpdater]);

  React.useEffect(() => {
    if (!hasUpdater) return undefined;
    const shouldCheck = !lastChecked || Date.now() - Number(lastChecked) > UPDATE_CHECK_INTERVAL_MS;
    if (shouldCheck) checkNow({ quiet: true });
    const id = setInterval(() => checkNow({ quiet: true }), UPDATE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasUpdater]);

  async function checkNow(options) {
    if (!hasUpdater) {
      setStatus("error");
      setMessage("Updates are available in the packaged desktop app.");
      return;
    }
    const quiet = !!(options && options.quiet);
    setStatus("checking");
    if (!quiet) setMessage("");
    setProgress({ downloaded: 0, total: 0 });
    try {
      const result = await desktop.checkForUpdates();
      const checkedAt = Date.now();
      localStorage.setItem(UPDATE_LAST_CHECKED_KEY, String(checkedAt));
      setLastChecked(checkedAt);
      if (result) {
        setUpdate(result);
        setStatus("available");
      } else {
        setUpdate(null);
        setStatus("upToDate");
        if (!quiet) setMessage("Pillar Press is up to date.");
      }
    } catch (error) {
      setStatus("error");
      if (!quiet) setMessage((error && error.message) || "Could not check for updates. Check your connection and try again.");
    }
  }

  async function installUpdate() {
    if (!update || !hasUpdater) return;
    setStatus("downloading");
    setMessage("");
    setProgress({ downloaded: 0, total: 0 });
    try {
      await desktop.downloadAndInstallUpdate(update, (event) => {
        const data = (event && event.data) || event || {};
        setProgress({
          downloaded: Number(data.downloaded || data.received || 0),
          total: Number(data.total || data.contentLength || 0),
        });
      });
      setStatus("readyToRestart");
      setMessage("Update installed. Restart Pillar Press to finish.");
    } catch (error) {
      setStatus("error");
      setMessage((error && error.message) || "Could not install the update. Try again.");
    }
  }

  const availableVersion = update && update.version ? update.version : "";
  const updateNotes = update && (update.body || (update.rawJson && update.rawJson.notes));
  const progressLabel = progress.total
    ? formatUpdateBytes(progress.downloaded) + " / " + formatUpdateBytes(progress.total)
    : progress.downloaded ? formatUpdateBytes(progress.downloaded) : "Preparing download";

  return (
    <section className="card" style={{ marginTop: 18, padding: 18, borderRadius: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 5 }}>Updates</div>
          <h3 style={{ margin: 0, fontSize: 22 }}>Keep Pillar Press current</h3>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 14.5, lineHeight: 1.45 }}>
            Current version{currentVersion ? ": " + currentVersion : ""}. Last checked: {formatUpdateCheckedAt(lastChecked)}.
          </p>
        </div>
        <button className="btn sm" disabled={!hasUpdater || status === "checking" || status === "downloading"} onClick={() => checkNow()}>
          {status === "checking" ? <><Spinner size={13} /> Checking</> : "Check for updates"}
        </button>
      </div>

      {status === "available" && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid var(--hair)", borderRadius: 8, background: "var(--paper-sunk)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <strong>Version {availableVersion} is available.</strong>
              {updateNotes && <p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{String(updateNotes).slice(0, 700)}</p>}
            </div>
            <button className="btn primary" onClick={installUpdate}>Update</button>
          </div>
        </div>
      )}

      {status === "downloading" && (
        <div style={{ marginTop: 14 }}>
          <div className="muted" style={{ fontSize: 13.5, marginBottom: 8 }}>Downloading update: {progressLabel}</div>
          <div style={{ height: 8, borderRadius: 999, background: "var(--paper-sunk)", overflow: "hidden", border: "1px solid var(--hair)" }}>
            <div style={{ width: progress.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) + "%" : "35%", height: "100%", background: "var(--accent)" }} />
          </div>
        </div>
      )}

      {status === "readyToRestart" && (
        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted">{message}</span>
          <button className="btn primary" onClick={() => desktop.restartApp()}>Restart to update</button>
        </div>
      )}

      {(status === "upToDate" || status === "error") && message && (
        <p style={{ margin: "12px 0 0", color: status === "error" ? "var(--sev-must)" : "var(--muted)", fontSize: 14 }}>
          {message}
        </p>
      )}
    </section>
  );
}

function App() {
  const state = useStore();
  const auth = useHostedAuth();
  const [view, setView] = React.useState("desk");
  const [desktopNotice, setDesktopNotice] = React.useState(null);
  const [backupBusy, setBackupBusy] = React.useState(false);
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [lastSetupResult, setLastSetupResult] = React.useState(null);
  const [sentimentOpen, setSentimentOpen] = React.useState(false);
  const [sentimentBusy, setSentimentBusy] = React.useState(false);
  const [campaignCreateOpen, setCampaignCreateOpen] = React.useState(false);
  const [billingOpen, setBillingOpen] = React.useState(false);
  const [billingNotice, setBillingNotice] = React.useState(null);
  const [activeDeskWorkflow, setActiveDeskWorkflow] = React.useState(null);
  const [feedbackOpenSignal, setFeedbackOpenSignal] = React.useState(0);
  const isMobile = window.useIsMobile();
  const role = state.role || "author";

  const campaigns = state.campaigns || [];
  const activeCampaign = campaigns.find((c) => c.id === state.activeCampaignId) || campaigns[0];
  const refs = window.Store.activeReferences ? window.Store.activeReferences() : ((activeCampaign && activeCampaign.references) || {});
  const refCtx = window.AI.refContext(refs);
  const campaignPieces = activeCampaign ? state.pieces.filter((p) => p.campaignId === activeCampaign.id) : [];
  const pieceCountsByCampaign = React.useMemo(() => {
    const counts = {};
    (campaigns || []).forEach((c) => {
      if (c && c.id) counts[c.id] = Number(c.pieceCount || 0);
    });
    const loadedCounts = {};
    (state.pieces || []).forEach((p) => {
      if (!p || !p.campaignId) return;
      loadedCounts[p.campaignId] = (loadedCounts[p.campaignId] || 0) + 1;
    });
    Object.keys(loadedCounts).forEach((id) => {
      counts[id] = loadedCounts[id];
    });
    return counts;
  }, [campaigns, state.pieces]);

  const active = state.pieces.find((p) => p.id === state.activePieceId);
  const inWorkspace = view === "workspace" && active;
  const hasDesktopBridge = !!(window.PILLAR_DESKTOP && window.PILLAR_DESKTOP.isDesktop && window.PILLAR_DESKTOP.isDesktop());
  const setupCompletePref = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.onboardingCompletePref) || "setupHelperCompleteV1";
  const firstValuePref = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.firstValuePref) || "onboardingFirstValueEventV1";
  const sentimentPref = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.sentimentPref) || "onboardingSentimentV1";
  const handoffPref = (window.KP_CONVERSATIONAL_ONBOARDING &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags &&
    window.KP_CONVERSATIONAL_ONBOARDING.flags.handoffPref) || "onboardingAssistantHandoffV1";

  const openPiece = (id) => { setActiveDeskWorkflow(null); window.Store.setActive(id); setView("workspace"); };
  const goLibrary = () => { setActiveDeskWorkflow(null); setView("library"); window.Store.setActive(null); };
  const goLibrarySection = (target) => {
    setActiveDeskWorkflow(null);
    if (target === "pieces" || target === "library") {
      goLibrary();
      return;
    }
    setView(target);
  };
  const openModelSetup = () => window.dispatchEvent(new Event("pillarpress:open-model-setup"));
  const openFeedback = () => setFeedbackOpenSignal((value) => value + 1);
  const openWorkflow = (workflowId) => {
    const workflow = DESK_WORKFLOWS.find((item) => item.id === workflowId);
    if (!workflow) return;
    if (window.Store && window.Store.setPref) window.Store.setPref("lastDeskWorkflow", workflowId);
    setActiveDeskWorkflow(workflowId);
    if (workflow.id === "book" || workflow.id === "gather" || workflow.id === "letter") {
      window.Store.setActive(null);
      setView(workflow.view);
      return;
    }
    if (!activeCampaign) {
      setCampaignCreateOpen(true);
      return;
    }
    const category = workflow.id === "letter" ? "letter" : workflow.id === "communication" ? "other" : "article";
    window.Store.createPiece(workflow.title, activeCampaign.id, {
      category,
      categoryContext: {
        communicationGoal: workflow.id === "communication" ? workflow.title : undefined,
        publicationGoal: workflow.id === "article" ? workflow.title : undefined,
      },
    });
    setView("workspace");
  };
  React.useEffect(() => {
    let cancelled = false;
    Promise.resolve(window.Store.ready).then(() => {
      if (cancelled) return;
      const firstValue = window.Store.getPref(firstValuePref, null);
      const onboardingComplete = window.Store.getPref(setupCompletePref, false);
      const shouldOpen = window.KP_CONVERSATIONAL_ONBOARDING && window.KP_CONVERSATIONAL_ONBOARDING.shouldOpenOnboarding
        ? window.KP_CONVERSATIONAL_ONBOARDING.shouldOpenOnboarding({ onboardingComplete, firstValue })
        : (!onboardingComplete && !(firstValue && firstValue.complete));
      if (shouldOpen) setSetupOpen(true);
    });
    return () => { cancelled = true; };
  }, []);
  React.useEffect(() => {
    const onBillingRequired = (event) => {
      const detail = (event && event.detail) || {};
      setBillingNotice(detail);
      setBillingOpen(true);
      if (window.Store && window.Store.refreshBilling) window.Store.refreshBilling();
    };
    window.addEventListener("pillarpress:billing-action-required", onBillingRequired);
    return () => window.removeEventListener("pillarpress:billing-action-required", onBillingRequired);
  }, []);

  React.useEffect(() => {
    const onStoreWarning = (event) => {
      const detail = (event && event.detail) || {};
      setDesktopNotice({
        type: "err",
        text: "Local save failed: " + (detail.message || "Try the action again before quitting."),
      });
    };
    window.addEventListener("pillarpress:store-warning", onStoreWarning);
    return () => window.removeEventListener("pillarpress:store-warning", onStoreWarning);
  }, []);
  const completeSetup = (payload) => {
    const result = payload || {};
    const handoff = window.Store.getPref(handoffPref, null);
    window.Store.setPref(setupCompletePref, true);
    setLastSetupResult(Object.assign({}, result, { handoff }));
    if (result.campaignId && window.Store.getCampaign && window.Store.getCampaign(result.campaignId)) {
      window.Store.setActiveCampaign(result.campaignId);
    }
    setSetupOpen(false);
    setView(result.routeTarget || (result.campaignId ? "desk" : "library"));
    if (handoff && handoff.transcriptTurnCount) {
      setDesktopNotice({
        type: "ok",
        text: "Setup saved. Your setup conversation is ready for the desk.",
      });
    }
    if (!window.Store.getPref(sentimentPref, null)) setSentimentOpen(true);
  };
  const submitSentiment = async (rating) => {
    setSentimentBusy(true);
    try {
      if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.submitSentiment) {
        await window.KP_ONBOARDING_ACTIONS.submitSentiment(rating, {
          sessionId: (lastSetupResult && lastSetupResult.sessionId) || "post-setup",
          firstValueComplete: !!(lastSetupResult && lastSetupResult.firstValue && lastSetupResult.firstValue.complete),
          campaignId: lastSetupResult && lastSetupResult.campaignId,
        });
      } else {
        window.Store.setPref(sentimentPref, {
          version: 1,
          rating,
          submittedAt: new Date().toISOString(),
          source: "post_onboarding_prompt",
        });
      }
      setSentimentOpen(false);
    } finally {
      setSentimentBusy(false);
    }
  };
  const dismissSentiment = () => {
    if (window.KP_ONBOARDING_ACTIONS && window.KP_ONBOARDING_ACTIONS.dismissSentiment) {
      window.KP_ONBOARDING_ACTIONS.dismissSentiment({ sessionId: "post-setup" });
    } else {
      window.Store.setPref(sentimentPref, {
        version: 1,
        dismissedAt: new Date().toISOString(),
        source: "post_onboarding_prompt",
      });
    }
    setSentimentOpen(false);
  };
  const createCampaign = (name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    window.Store.addCampaign(clean);
    setCampaignCreateOpen(false);
    setActiveDeskWorkflow(null);
    setView("library");
  };
  const createDesktopBackup = async () => {
    if (!hasDesktopBridge || backupBusy) return;
    setBackupBusy(true);
    setDesktopNotice(null);
    try {
      const result = await window.PILLAR_DESKTOP.createLocalBackup();
      setDesktopNotice({ type: "ok", text: "Backup created with secrets redacted" + (result && result.path ? ": " + result.path : ".") });
    } catch (e) {
      setDesktopNotice({ type: "err", text: (e && e.message) || "Could not create local backup. Try again before quitting." });
    }
    setBackupBusy(false);
  };
  const signOutHosted = async () => {
    if (window.KP_AUTH && window.KP_AUTH.signOut) await window.KP_AUTH.signOut();
    if (window.Store && window.Store.resetForAuth) window.Store.resetForAuth();
  };

  if (auth.requiresLogin && (!auth.authenticated || auth.recovery)) return <HostedAuthScreen auth={auth} />;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" onClick={() => { setActiveDeskWorkflow(null); window.Store.setActive(null); setView("desk"); }}>
          <img className="brand-icon" src="/brand/pillar-press-product-mark.png" alt="" aria-hidden="true" />
          <span className="mark">Pillar <span className="em">Press</span></span>
          <span className="sub">Editorial Desk</span>
        </div>
        <nav className="topnav">
          <DeskWorkflowMenu
            activeView={view}
            activeWorkflow={activeDeskWorkflow}
            onOpenWorkflow={openWorkflow}
            onOpenDesk={() => { setActiveDeskWorkflow(null); window.Store.setActive(null); setView("desk"); }}
          />
          <LibraryMenuButton view={view} onSelect={goLibrarySection} />
          <button
            className={view === "references" ? "active" : ""}
            aria-current={view === "references" ? "page" : undefined}
            onClick={() => { setActiveDeskWorkflow(null); window.Store.setActive(null); setView("references"); }}
          >
            Preferences
          </button>
        </nav>
        <div className="spacer" />
        <CampaignSwitcher campaigns={campaigns} activeId={state.activeCampaignId} pieceCounts={pieceCountsByCampaign}
          onSelect={(id) => window.Store.setActiveCampaign(id)} onAdd={() => setCampaignCreateOpen(true)} />
        {!isMobile && <RoleSwitch role={role} onChange={(r) => window.Store.setRole(r)} />}
        <button className="btn sm" onClick={() => setSetupOpen(true)} title="Setup provider, campaign, and preferences">
          <Icon name="gear" size={13} /> Setup
        </button>
        <button className="btn sm ghost" onClick={openFeedback} title="Send feedback">
          <Icon name="flag" size={13} /> Feedback
        </button>
        {auth.hosted && (
          <button className="btn sm ghost" onClick={() => { setBillingNotice(null); window.Store.refreshBilling(); setBillingOpen(true); }} title="Billing and usage">
            Billing
          </button>
        )}
        {auth.requiresLogin && (
          <button className="btn sm ghost" onClick={signOutHosted} title="Sign out">
            Sign out
          </button>
        )}
        {(hasDesktopBridge || auth.hosted) && (
          <>
            {hasDesktopBridge && (
              <button className="btn sm ghost" onClick={createDesktopBackup} title="Create local backup" disabled={backupBusy}>
                {backupBusy ? <Spinner size={15} /> : <Icon name="db" size={16} />}
                Backup
              </button>
            )}
            <button className="icon-btn" onClick={openModelSetup} title="Model settings">
              <Icon name="key" size={16} />
            </button>
          </>
        )}
        <button className="icon-btn" onClick={() => window.Store.toggleTheme()} title="Toggle light / dark">
          <Icon name={state.theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
      </div>

      {!activeCampaign && (
        <EmptyState
          icon="book"
          title="Create your first campaign"
          body="Pillar Press starts empty now. Add only the campaigns you actually use, then write pieces, preferences, Gather sources, and Studio assets inside that campaign."
          action={<button className="btn primary" style={{ marginTop: 18 }} onClick={() => setCampaignCreateOpen(true)}><Icon name="plus" size={15} /> New campaign</button>}
        />
      )}

      {activeCampaign && view === "references" && <References refs={refs} role={role} campaignName={activeCampaign && activeCampaign.name} />}
      {activeCampaign && view === "desk" && (
        <Desk campaignId={activeCampaign.id} onOpenPiece={openPiece} />
      )}
      {activeCampaign && view === "letter" && (
        <LetterDesk campaignId={activeCampaign.id} onOpenPiece={openPiece} />
      )}
      {activeCampaign && view === "weave" && (
        <Weave weave={window.Store.getWeave()} refCtx={refCtx} campaignId={activeCampaign.id} onOpenPiece={openPiece} />
      )}
      {activeCampaign && view === "gather" && (
        <Gather campaignId={activeCampaign.id} refCtx={refCtx} onGoWeave={() => goLibrarySection("weave")} />
      )}
      {activeCampaign && view === "studio" && (
        <Studio campaignId={activeCampaign.id} pieces={campaignPieces} onOpenPiece={openPiece} />
      )}
      {activeCampaign && view === "book" && (
        <BookWriter campaigns={campaigns} allPieces={state.pieces} role={role}
          onOpenPiece={openPiece} onActivateCampaign={(id) => window.Store.setActiveCampaign(id)}
          onShowLibrary={(id) => { window.Store.setActive(id); setView("library"); }} />
      )}
      {activeCampaign && view === "library" && (
        <Library pieces={campaignPieces} campaignName={activeCampaign && activeCampaign.name}
          campaigns={campaigns} allPieces={state.pieces} activeCampaignId={activeCampaign.id}
          onOpen={openPiece}
          onNew={() => { setActiveDeskWorkflow(null); window.Store.createPiece("Untitled piece"); setView("workspace"); }}
          onDelete={(id) => window.Store.deletePiece(id)}
          onOpenWeave={() => goLibrarySection("weave")}
          onOpenStudio={() => goLibrarySection("studio")}
          onSwitchCampaign={(id) => { window.Store.setActiveCampaign(id); setView("library"); }} />
      )}
      {activeCampaign && inWorkspace && <Workspace piece={active} refs={refs} onBack={goLibrary} onGoStudio={() => goLibrarySection("studio")} />}
      {activeCampaign && view === "workspace" && !active && (
        <EmptyState icon="doc" title="No piece open" body="Head back to the Library to open or start one." />
      )}
      {desktopNotice && (
        <div role={desktopNotice.type === "err" ? "alert" : "status"} style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 180, maxWidth: "min(520px, calc(100vw - 36px))",
          padding: "10px 13px", borderRadius: "var(--radius)", boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--hair)", background: "var(--paper-2)",
          color: desktopNotice.type === "err" ? "var(--sev-must)" : "var(--ink)",
          fontSize: 13.5, lineHeight: 1.45,
        }}>
          {desktopNotice.text}
          <button className="icon-btn" style={{ width: 24, height: 24, marginLeft: 8, verticalAlign: "middle" }} onClick={() => setDesktopNotice(null)} title="Dismiss">
            <Icon name="xLogo" size={13} />
          </button>
        </div>
      )}
      {sentimentOpen && (
        <div role="dialog" aria-modal="false" aria-label="Setup usefulness rating" style={{
          position: "fixed", right: 18, bottom: 18, zIndex: 181, width: "min(390px, calc(100vw - 36px))",
          padding: 18, borderRadius: 14, boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--hair)", background: "var(--paper-2)", color: "var(--ink)",
        }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500 }}>
            Was setup useful?
          </h2>
          <p style={{ margin: "8px 0 14px", color: "var(--muted)", lineHeight: 1.45 }}>
            One quick rating helps tune the onboarding without sending anything outside this app.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5].map((rating) => (
              <button
                key={rating}
                className="btn sm"
                disabled={sentimentBusy}
                onClick={() => submitSentiment(rating)}
                aria-label={"Rate setup " + rating + " out of 5"}
              >
                {rating}
              </button>
            ))}
            <button className="btn sm ghost" disabled={sentimentBusy} onClick={dismissSentiment}>
              Not now
            </button>
          </div>
        </div>
      )}
      <TweaksLayer theme={state.theme} />
      {window.SetupHelper && (
        <SetupHelper
          open={setupOpen}
          onClose={() => setSetupOpen(false)}
          onOpenProviderSetup={openModelSetup}
          onComplete={completeSetup}
        />
      )}
      <CampaignCreateDialog open={campaignCreateOpen} onClose={() => setCampaignCreateOpen(false)} onCreate={createCampaign} />
      <BillingPanel open={billingOpen} onClose={() => setBillingOpen(false)} billing={state.billing} notice={billingNotice} />
      <DesktopOnboarding />
      {window.FeedbackWidget && (
        <FeedbackWidget
          route={view || "desk"}
          openSignal={feedbackOpenSignal}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
