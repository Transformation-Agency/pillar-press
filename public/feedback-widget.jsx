/* In-app feedback widget. Exports to window. */

const PILLAR_PRESS_FEEDBACK_TYPES = [
  { id: "bug", label: "Bug" },
  { id: "feature", label: "Feature" },
  { id: "feedback", label: "Feedback" },
];
const PILLAR_PRESS_FEEDBACK_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

function pillarPressFeedbackPlatform() {
  const desktop = window.PILLAR_DESKTOP;
  return desktop && desktop.isDesktop && desktop.isDesktop() ? "desktop" : "web";
}

async function pillarPressFeedbackAppVersion() {
  const desktop = window.PILLAR_DESKTOP;
  if (desktop && desktop.appVersion) {
    try {
      return await desktop.appVersion();
    } catch (e) {}
  }
  return window.PILLAR_PRESS_APP_VERSION || "";
}

function pillarPressFeedbackContext(route, appVersion) {
  return {
    product: "pillar-press",
    route: route || "unknown",
    appVersion: appVersion || "",
    platform: pillarPressFeedbackPlatform(),
    userAgent: window.navigator ? window.navigator.userAgent : "",
    timestamp: new Date().toISOString(),
  };
}

function readPillarPressFeedbackScreenshot(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    if (!/^image\//i.test(file.type || "")) {
      reject(new Error("Use an image file for the screenshot."));
      return;
    }
    if (file.size > PILLAR_PRESS_FEEDBACK_MAX_SCREENSHOT_BYTES) {
      reject(new Error("Screenshots must be 5 MB or smaller."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: String(reader.result || ""), name: file.name || "feedback-screenshot" });
    reader.onerror = () => reject(new Error("Could not read that screenshot."));
    reader.readAsDataURL(file);
  });
}

function FeedbackWidget({ route, openSignal }) {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState("feedback");
  const [alias, setAlias] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [screenshot, setScreenshot] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState(null);
  const [appVersion, setAppVersion] = React.useState("");
  const fileRef = React.useRef(null);

  React.useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  React.useEffect(() => {
    let cancelled = false;
    pillarPressFeedbackAppVersion().then((value) => {
      if (!cancelled) setAppVersion(value || "");
    });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!open) return undefined;
    const onPaste = async (event) => {
      const items = event.clipboardData && event.clipboardData.items ? Array.from(event.clipboardData.items) : [];
      const item = items.find((entry) => entry && /^image\//i.test(entry.type || ""));
      if (!item) return;
      const file = item.getAsFile && item.getAsFile();
      if (!file) return;
      event.preventDefault();
      try {
        setScreenshot(await readPillarPressFeedbackScreenshot(file));
        setMessage(null);
      } catch (e) {
        setMessage({ type: "error", text: (e && e.message) || "Could not attach that screenshot." });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open]);

  const reset = () => {
    setType("feedback");
    setAlias("");
    setSummary("");
    setDetails("");
    setScreenshot(null);
    setMessage(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setMessage(null);
  };

  const attachFile = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      setScreenshot(await readPillarPressFeedbackScreenshot(file));
      setMessage(null);
    } catch (e) {
      setMessage({ type: "error", text: (e && e.message) || "Could not attach that screenshot." });
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!details.trim() || busy) {
      setMessage({ type: "error", text: "Add a few details before sending feedback." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.submitPillarPressFeedback(Object.assign(
        pillarPressFeedbackContext(route, appVersion),
        {
          type,
          summary: summary.trim(),
          details: details.trim(),
          alias: alias.trim(),
          screenshotDataUrl: screenshot && screenshot.dataUrl,
          screenshotName: screenshot && screenshot.name,
        }
      ));
      if (!result || result.success === false) {
        throw new Error((result && result.error) || "Feedback could not be submitted.");
      }
      setMessage({
        type: "success",
        text: result.issueNumber ? "Feedback sent as issue #" + result.issueNumber + "." : "Feedback sent. Thank you.",
      });
      window.setTimeout(() => {
        reset();
        setOpen(false);
      }, 1300);
    } catch (e) {
      setMessage({ type: "error", text: (e && e.message) || "Feedback could not be submitted." });
    }
    setBusy(false);
  };

  return (
    <>
      <button className="feedback-fab" onClick={() => setOpen(true)} title="Send feedback" aria-label="Send feedback">
        <Icon name="flag" size={18} />
        <span>Feedback</span>
      </button>
      {open && (
        <div className="feedback-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <form className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="pillar-feedback-title" onSubmit={submit}>
            <div className="feedback-modal-head">
              <div>
                <div className="eyebrow">Pillar Press feedback</div>
                <h2 id="pillar-feedback-title">Send feedback</h2>
                <p className="muted">Share what broke, what would help, or what felt off. Screenshots are optional.</p>
              </div>
              <button type="button" className="icon-btn" onClick={close} title="Close feedback"><Icon name="xLogo" size={14} /></button>
            </div>

            <div className="feedback-form">
              <div className="feedback-grid" role="group" aria-label="Feedback type">
                {PILLAR_PRESS_FEEDBACK_TYPES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={type === option.id ? "active" : ""}
                    onClick={() => setType(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label>
                <span>Alias or email <em>optional</em></span>
                <input className="field" value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="How should we identify you?" />
              </label>
              <label>
                <span>Summary <em>optional</em></span>
                <input className="field" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Short title" />
              </label>
              <label>
                <span>Details</span>
                <textarea className="field" rows={7} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="What happened? What were you trying to do?" required />
              </label>

              <div className="feedback-screenshot">
                <div>
                  <strong>Screenshot</strong>
                  <p className="muted">Upload or paste an image while this window is open. Max 5 MB.</p>
                </div>
                <div className="feedback-screenshot-actions">
                  <input ref={fileRef} className="feedback-file-input" type="file" accept="image/*" onChange={attachFile} />
                  <button type="button" className="feedback-small-button" onClick={() => fileRef.current && fileRef.current.click()}>
                    <Icon name="upload" size={14} /> Choose image
                  </button>
                  {screenshot && (
                    <button type="button" className="feedback-small-button" onClick={() => { setScreenshot(null); if (fileRef.current) fileRef.current.value = ""; }}>
                      Remove
                    </button>
                  )}
                </div>
                {screenshot && (
                  <div className="feedback-preview">
                    <img src={screenshot.dataUrl} alt="Feedback screenshot preview" />
                    <span>{screenshot.name}</span>
                  </div>
                )}
              </div>

              {message && <p className={"feedback-message " + message.type}>{message.text}</p>}
              <div className="feedback-actions">
                <button type="button" className="btn ghost" onClick={close} disabled={busy}>Cancel</button>
                <button type="submit" className="btn primary" disabled={busy || !details.trim()}>
                  {busy ? <><Spinner size={14} /> Sending</> : "Send feedback"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

Object.assign(window, {
  FeedbackWidget,
  pillarPressFeedbackContext,
  readPillarPressFeedbackScreenshot,
});
