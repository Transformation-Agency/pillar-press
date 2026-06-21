function LetterDesk({ campaignId, onOpenPiece }) {
  const state = window.Store.getState();
  const recipients = window.Store.getRecipients();
  const workflows = window.Store.getLetterWorkflows(campaignId);
  const [selectedRecipientId, setSelectedRecipientId] = React.useState(recipients[0] ? recipients[0].id : "");
  const [selectedWorkflowId, setSelectedWorkflowId] = React.useState(workflows[0] ? workflows[0].id : "");
  const [recipientDraft, setRecipientDraft] = React.useState({
    displayName: "",
    organization: "",
    role: "",
    relationship: "",
    defaultSalutation: "",
    defaultSignoff: "",
    defaultTone: "",
    notes: "",
  });
  const [workflowDraft, setWorkflowDraft] = React.useState({
    purpose: "",
    desiredOutcome: "",
    occasion: "",
    tone: "",
    constraints: "",
    sourceContext: "",
    dictationTranscript: "",
    uploads: [],
  });
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const fileRef = React.useRef(null);
  const isMobile = window.useIsMobile();

  React.useEffect(() => { window.Store.refreshRecipients().catch(() => null); }, []);
  React.useEffect(() => { if (campaignId) window.Store.refreshLetterWorkflows(campaignId).catch(() => null); }, [campaignId]);
  React.useEffect(() => {
    if (!selectedRecipientId && recipients[0]) setSelectedRecipientId(recipients[0].id);
  }, [recipients.length]);
  React.useEffect(() => {
    if (!selectedWorkflowId && workflows[0]) setSelectedWorkflowId(workflows[0].id);
  }, [workflows.length]);

  const selectedRecipient = recipients.find((r) => r.id === selectedRecipientId) || null;
  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId) || null;

  React.useEffect(() => {
    if (!selectedWorkflow) return;
    setSelectedRecipientId(selectedWorkflow.recipientId || "");
    setWorkflowDraft({
      purpose: selectedWorkflow.purpose || "",
      desiredOutcome: selectedWorkflow.desiredOutcome || "",
      occasion: selectedWorkflow.occasion || "",
      tone: selectedWorkflow.tone || "",
      constraints: selectedWorkflow.constraints || "",
      sourceContext: selectedWorkflow.sourceContext || "",
      dictationTranscript: selectedWorkflow.dictationTranscript || "",
      uploads: Array.isArray(selectedWorkflow.uploads) ? selectedWorkflow.uploads : [],
    });
  }, [selectedWorkflowId]);

  const updateRecipientDraft = (key, value) => setRecipientDraft((d) => Object.assign({}, d, { [key]: value }));
  const updateWorkflowDraft = (key, value) => setWorkflowDraft((d) => Object.assign({}, d, { [key]: value }));

  const clearRecipientDraft = () => setRecipientDraft({
    displayName: "",
    organization: "",
    role: "",
    relationship: "",
    defaultSalutation: "",
    defaultSignoff: "",
    defaultTone: "",
    notes: "",
  });

  const saveRecipient = async () => {
    if (!recipientDraft.displayName.trim()) return;
    setBusy("recipient"); setError(""); setMessage("");
    try {
      const recipient = await window.Store.createRecipient({
        displayName: recipientDraft.displayName,
        organization: recipientDraft.organization || null,
        role: recipientDraft.role || null,
        relationship: recipientDraft.relationship || null,
        defaultSalutation: recipientDraft.defaultSalutation || null,
        defaultSignoff: recipientDraft.defaultSignoff || null,
        defaultTone: recipientDraft.defaultTone || null,
        notes: recipientDraft.notes || null,
        preferences: {},
      });
      setSelectedRecipientId(recipient.id);
      clearRecipientDraft();
      setMessage("Recipient saved.");
    } catch (e) {
      setError((e && e.message) || "Could not save recipient.");
    } finally {
      setBusy("");
    }
  };

  const snapshotFor = (recipient) => recipient ? {
    id: recipient.id,
    displayName: recipient.displayName,
    organization: recipient.organization || null,
    role: recipient.role || null,
    relationship: recipient.relationship || null,
    defaultSalutation: recipient.defaultSalutation || null,
    defaultSignoff: recipient.defaultSignoff || null,
    defaultTone: recipient.defaultTone || null,
    notes: recipient.notes || null,
    preferences: recipient.preferences || {},
  } : {};

  const saveWorkflow = async () => {
    if (!campaignId) return null;
    setBusy("workflow"); setError(""); setMessage("");
    try {
      const payload = Object.assign({}, workflowDraft, {
        campaignId,
        recipientId: selectedRecipient ? selectedRecipient.id : null,
        recipientSnapshot: snapshotFor(selectedRecipient),
      });
      const workflow = selectedWorkflow
        ? await window.Store.updateLetterWorkflow(selectedWorkflow.id, payload)
        : await window.Store.createLetterWorkflow(payload);
      setSelectedWorkflowId(workflow.id);
      setMessage("Letter workflow saved.");
      return workflow;
    } catch (e) {
      setError((e && e.message) || "Could not save workflow.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const generateDraft = async () => {
    setBusy("draft"); setError(""); setMessage("");
    try {
      const workflow = await saveWorkflow();
      if (!workflow) return;
      setBusy("draft");
      const res = await window.Store.draftLetterWorkflow(workflow.id);
      if (res && res.piece) {
        setMessage("Draft saved to the campaign library.");
        onOpenPiece && onOpenPiece(res.piece.id);
      }
    } catch (e) {
      setError((e && e.message) || "Could not generate draft.");
    } finally {
      setBusy("");
    }
  };

  const uploadFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy("upload"); setError(""); setMessage("");
    try {
      const extracted = [];
      for (const file of list) {
        const text = await window.extractFileText(file);
        extracted.push({ name: file.name, text, size: file.size, mimeType: file.type || null });
      }
      updateWorkflowDraft("uploads", (workflowDraft.uploads || []).concat(extracted));
      setMessage(extracted.length + " file" + (extracted.length === 1 ? "" : "s") + " added.");
    } catch (e) {
      setError((e && e.message) || "Could not read file.");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeUpload = (index) => {
    updateWorkflowDraft("uploads", (workflowDraft.uploads || []).filter((_, i) => i !== index));
  };

  const openExistingPiece = () => {
    const pieceId = selectedWorkflow && selectedWorkflow.pieceId;
    if (pieceId) onOpenPiece && onOpenPiece(pieceId);
  };

  return (
    <div className="scroll-y" style={{ flex: 1 }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: isMobile ? "18px 16px 90px" : "30px 32px 100px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 22 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Letter workflow</div>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 500 }}>Saved recipients</h1>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {selectedWorkflow && selectedWorkflow.pieceId && (
              <button className="btn" onClick={openExistingPiece}><Icon name="jump" size={14} /> Open piece</button>
            )}
            <button className="btn" onClick={saveWorkflow} disabled={!!busy}>{busy === "workflow" ? <Spinner size={14} /> : <Icon name="check" size={14} />} Save</button>
            <button className="btn primary" onClick={generateDraft} disabled={!!busy || !selectedRecipient}>
              {busy === "draft" ? <Spinner size={14} /> : <Icon name="sparkle" size={14} />} Generate draft
            </button>
          </div>
        </div>

        {(message || error) && (
          <p role={error ? "alert" : "status"} style={{ margin: "0 0 14px", color: error ? "var(--sev-must)" : "var(--muted)" }}>
            {error || message}
          </p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "300px minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
          <aside style={{ display: "grid", gap: 14 }}>
            <section className="card" style={{ padding: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Recipients</div>
              <div style={{ display: "grid", gap: 6 }}>
                {recipients.map((recipient) => {
                  const on = recipient.id === selectedRecipientId;
                  return (
                    <button key={recipient.id} onClick={() => setSelectedRecipientId(recipient.id)}
                      style={{
                        border: "1px solid " + (on ? "var(--accent)" : "var(--hair)"),
                        background: on ? "var(--accent-soft)" : "var(--paper)",
                        color: "var(--ink)", borderRadius: 8, padding: 10,
                        textAlign: "left", cursor: "pointer",
                      }}>
                      <strong style={{ display: "block", fontSize: 14.5 }}>{recipient.displayName}</strong>
                      <span className="muted" style={{ fontSize: 12.5 }}>{recipient.organization || recipient.relationship || "Saved recipient"}</span>
                    </button>
                  );
                })}
                {!recipients.length && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>No saved recipients yet.</p>}
              </div>
            </section>

            <section className="card" style={{ padding: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Recent letters</div>
              <div style={{ display: "grid", gap: 6 }}>
                {workflows.map((workflow) => {
                  const on = workflow.id === selectedWorkflowId;
                  const name = workflow.recipientSnapshot && workflow.recipientSnapshot.displayName;
                  return (
                    <button key={workflow.id} onClick={() => setSelectedWorkflowId(workflow.id)}
                      style={{
                        border: "1px solid " + (on ? "var(--accent)" : "var(--hair)"),
                        background: on ? "var(--accent-soft)" : "var(--paper)",
                        color: "var(--ink)", borderRadius: 8, padding: 10,
                        textAlign: "left", cursor: "pointer",
                      }}>
                      <strong style={{ display: "block", fontSize: 14.5 }}>{name || "Letter workflow"}</strong>
                      <span className="muted" style={{ fontSize: 12.5 }}>{workflow.status || "draft"} · {window.relTime(new Date(workflow.updatedAt || workflow.createdAt).getTime())}</span>
                    </button>
                  );
                })}
                {!workflows.length && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>No letter workflows yet.</p>}
              </div>
            </section>
          </aside>

          <main style={{ display: "grid", gap: 18 }}>
            <section className="card" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>New recipient</div>
                  <h2 style={{ margin: 0, fontSize: 22 }}>Context and default tone</h2>
                </div>
                <button className="btn" onClick={saveRecipient} disabled={busy === "recipient" || !recipientDraft.displayName.trim()}>
                  {busy === "recipient" ? <Spinner size={14} /> : <Icon name="plus" size={14} />} Save recipient
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                <input className="field" value={recipientDraft.displayName} onChange={(e) => updateRecipientDraft("displayName", e.target.value)} placeholder="Display name" />
                <input className="field" value={recipientDraft.organization} onChange={(e) => updateRecipientDraft("organization", e.target.value)} placeholder="Organization" />
                <input className="field" value={recipientDraft.role} onChange={(e) => updateRecipientDraft("role", e.target.value)} placeholder="Role" />
                <input className="field" value={recipientDraft.defaultSalutation} onChange={(e) => updateRecipientDraft("defaultSalutation", e.target.value)} placeholder="Default salutation" />
                <input className="field" value={recipientDraft.defaultSignoff} onChange={(e) => updateRecipientDraft("defaultSignoff", e.target.value)} placeholder="Default signoff" />
                <input className="field" value={recipientDraft.defaultTone} onChange={(e) => updateRecipientDraft("defaultTone", e.target.value)} placeholder="Default tone" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginTop: 10 }}>
                <textarea value={recipientDraft.relationship} onChange={(e) => updateRecipientDraft("relationship", e.target.value)} placeholder="Relationship context" style={{ minHeight: 90 }} />
                <textarea value={recipientDraft.notes} onChange={(e) => updateRecipientDraft("notes", e.target.value)} placeholder="Recipient notes, preferences, structure guidance" style={{ minHeight: 90 }} />
              </div>
            </section>

            <section className="card" style={{ padding: 18 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Compose letter</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                <select className="field" value={selectedRecipientId} onChange={(e) => setSelectedRecipientId(e.target.value)}>
                  <option value="">Choose recipient</option>
                  {recipients.map((r) => <option key={r.id} value={r.id}>{r.displayName}</option>)}
                </select>
                <input className="field" value={workflowDraft.occasion} onChange={(e) => updateWorkflowDraft("occasion", e.target.value)} placeholder="Occasion" />
                <input className="field" value={workflowDraft.tone} onChange={(e) => updateWorkflowDraft("tone", e.target.value)} placeholder="Tone for this letter" />
                <input className="field" value={workflowDraft.desiredOutcome} onChange={(e) => updateWorkflowDraft("desiredOutcome", e.target.value)} placeholder="Desired outcome" />
              </div>
              <textarea value={workflowDraft.purpose} onChange={(e) => updateWorkflowDraft("purpose", e.target.value)} placeholder="Purpose" style={{ minHeight: 96, marginTop: 10 }} />
              <textarea value={workflowDraft.constraints} onChange={(e) => updateWorkflowDraft("constraints", e.target.value)} placeholder="Structure, boundaries, lines to avoid" style={{ minHeight: 96, marginTop: 10 }} />
              <textarea value={workflowDraft.sourceContext} onChange={(e) => updateWorkflowDraft("sourceContext", e.target.value)} placeholder="Manual guidance or pasted background" style={{ minHeight: 120, marginTop: 10 }} />
              <textarea value={workflowDraft.dictationTranscript} onChange={(e) => updateWorkflowDraft("dictationTranscript", e.target.value)} placeholder="Dictation transcript" style={{ minHeight: 120, marginTop: 10 }} />

              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
                <input ref={fileRef} type="file" multiple accept={window.UPLOAD_ACCEPT} onChange={(e) => uploadFiles(e.target.files)} style={{ display: "none" }} />
                <button className="btn" onClick={() => fileRef.current && fileRef.current.click()} disabled={!!busy}>
                  {busy === "upload" ? <Spinner size={14} /> : <Icon name="upload" size={14} />} Add files
                </button>
                <span className="muted" style={{ fontSize: 13 }}>{(workflowDraft.uploads || []).length} uploaded</span>
              </div>

              {!!(workflowDraft.uploads || []).length && (
                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                  {workflowDraft.uploads.map((upload, index) => (
                    <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", border: "1px solid var(--hair)", borderRadius: 8, padding: "8px 10px" }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{upload.name}</span>
                      <button className="icon-btn" onClick={() => removeUpload(index)} title="Remove file"><Icon name="trash" size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LetterDesk });
