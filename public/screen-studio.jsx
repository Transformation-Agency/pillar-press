/* Studio — provider-backed media generation surface. */

function MediaProvidersDialog({ status, onClose }) {
  const providers = (status && status.providers) || [];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", display: "grid", placeItems: "center", zIndex: 80 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "92vw", padding: "26px 28px" }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Media providers</div>
        <h2 style={{ fontSize: 24, marginBottom: 10 }}>Optional cloud media</h2>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 18 }}>
          Studio can use any configured server-side media provider. Keys stay in the packaged server environment or native app settings, never in browser storage.
        </p>
        <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
          {providers.map((p) => (
            <div key={p.id} className="card" style={{ padding: "10px 12px", borderRadius: "var(--radius)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 15 }}>{p.label}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{(p.capabilities || []).join(", ") || "No capabilities"}</div>
              </div>
              <StatusChipMini ok={!!p.configured} label={p.configured ? "Configured" : "Not configured"} />
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 18 }}>
          Configure <span className="mono">HEDRA_API_KEY</span>, <span className="mono">ELEVENLABS_API_KEY</span>,
          <span className="mono"> OPENAI_API_KEY</span>, <span className="mono">XAI_API_KEY</span>, or custom <span className="mono">MEDIA_IMAGE_*</span> variables for the providers you want to use.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function StatusChipMini({ ok, label }) {
  return (
    <span className="chip" style={{ color: ok ? "var(--st-approved)" : "var(--ink-3)", borderColor: ok ? "var(--st-approved)" : "var(--hair)" }}>
      <span className="dot" style={{ background: ok ? "var(--st-approved)" : "var(--hair-2)" }} />{label}
    </span>
  );
}

function StartImageField({ value, aspect, prompt, libraryImages, onChange }) {
  const fileRef = React.useRef(null);
  const [pick, setPick] = React.useState(false);
  const upload = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => onChange(r.result); r.readAsDataURL(f); e.target.value = "";
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ width: 84, flexShrink: 0 }}>
          <AspectBox aspect={aspect}>
            {value ? <img src={value} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--ink-3)" }}><Icon name="image" size={20} /></div>}
          </AspectBox>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, position: "relative" }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={upload} />
          <button className="btn sm" onClick={() => fileRef.current.click()}><Icon name="upload" size={13} /> Upload image</button>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn ghost sm" onClick={() => setPick((o) => !o)} disabled={!libraryImages.length}><Icon name="image" size={13} /> From library</button>
            <button className="btn ghost sm" onClick={() => onChange(window.STUDIO.makeImagePlaceholder(prompt || "frame", aspect, "FRAME"))} title="Generate a start frame from the prompt"><Icon name="sparkle" size={13} /> AI frame</button>
          </div>
          {value && <button className="btn ghost sm" onClick={() => onChange(null)} style={{ alignSelf: "flex-start", color: "var(--ink-3)" }}>Clear</button>}
          {pick && (
            <div className="card" style={{ position: "absolute", top: 64, left: 0, zIndex: 30, width: 260, maxHeight: 220, overflowY: "auto", padding: 8, boxShadow: "var(--shadow-lg)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {libraryImages.map((m) => (
                <button key={m.id} onClick={() => { onChange(m.outputUrl); setPick(false); }} style={{ border: "1px solid var(--hair)", borderRadius: 6, overflow: "hidden", cursor: "pointer", padding: 0, background: "none" }}>
                  <img src={m.outputUrl} alt="" style={{ width: "100%", display: "block", aspectRatio: "1", objectFit: "cover" }} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {options.map((o) => {
        const v = typeof o === "object" ? o.v : o, l = typeof o === "object" ? o.l : o;
        const on = v === value;
        return <button key={v} onClick={() => onChange(v)} className="mono" style={{ fontSize: 12, padding: "6px 11px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? "var(--accent)" : "var(--hair)"), background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent-ink)" : "var(--ink-2)" }}>{l}</button>;
      })}
    </div>
  );
}

function StField({ label, children }) {
  return <div style={{ marginBottom: 16 }}><div className="eyebrow" style={{ marginBottom: 7 }}>{label}</div>{children}</div>;
}

function StToggle({ on, onChange }) {
  return (
    <button onClick={onChange} style={{ width: 40, height: 23, borderRadius: 999, border: "none", cursor: "pointer", padding: 2, background: on ? "var(--accent)" : "var(--hair-2)", flexShrink: 0 }}>
      <span style={{ display: "block", width: 19, height: 19, borderRadius: 999, background: "var(--paper-2)", transform: on ? "translateX(17px)" : "translateX(0)", transition: "transform 0.2s", boxShadow: "var(--shadow-sm)" }} />
    </button>
  );
}

function StyleSurveyModal({ campaignId, profile, mediaJobId, onClose, onSaved }) {
  const K = window.STUDIO.STYLE_KNOBS;
  const base = (profile && profile.knobs) || {};
  const [rating, setRating] = React.useState(4);
  const [knobs, setKnobs] = React.useState({ palette: base.palette || "warm", mood: base.mood || "neutral", finish: base.finish || "photographic", detail: base.detail || "balanced" });
  const [working, setWorking] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const setKnob = (k, v) => setKnobs((o) => Object.assign({}, o, { [k]: v }));
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const p = await window.STUDIO.sendStyleFeedback(campaignId, { rating, knobs, working, notes, mediaJobId: mediaJobId || undefined });
      onSaved(p);
    } catch (e) { setErr((e && e.message) || "Couldn't save."); setSaving(false); }
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", padding: "24px 26px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ fontSize: 22 }}>Tune image style</h3>
          <span className="mono muted" style={{ fontSize: 11 }}>round {profile ? profile.rounds : 0} → {(profile ? profile.rounds : 0) + 1}</span>
        </div>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 4, marginBottom: 14 }}>Rate the latest image and nudge the knobs. Your taste folds into an evolving directive that steers future images for this campaign.</p>
        <StField label="Rating"><Segmented value={rating} onChange={setRating} options={[1, 2, 3, 4, 5].map((n) => ({ v: n, l: String(n) }))} /></StField>
        <StField label="Palette"><Segmented value={knobs.palette} onChange={(v) => setKnob("palette", v)} options={K.palette} /></StField>
        <StField label="Mood"><Segmented value={knobs.mood} onChange={(v) => setKnob("mood", v)} options={K.mood} /></StField>
        <StField label="Finish"><Segmented value={knobs.finish} onChange={(v) => setKnob("finish", v)} options={K.finish} /></StField>
        <StField label="Detail"><Segmented value={knobs.detail} onChange={(v) => setKnob("detail", v)} options={K.detail} /></StField>
        <StField label="What's working"><textarea className="field" value={working} onChange={(e) => setWorking(e.target.value)} placeholder="Keep this…" style={{ minHeight: 54, fontSize: 14, resize: "vertical" }} /></StField>
        <StField label="What's off / want more of"><textarea className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Change this…" style={{ minHeight: 54, fontSize: 14, resize: "vertical" }} /></StField>
        {profile && profile.directive &&
          <div style={{ marginBottom: 14 }}><div className="eyebrow" style={{ marginBottom: 4 }}>Current directive</div><div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{profile.directive}</div></div>}
        {err && <p style={{ color: "var(--sev-must)", fontSize: 13 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? <><Spinner size={14} /> Saving…</> : "Save & update style"}</button>
        </div>
      </div>
    </div>
  );
}

function Studio({ campaignId, pieces, onOpenPiece }) {
  const isMobile = window.useIsMobile();
  const settings = window.Store.getSettings();
  const allMedia = window.Store.mediaForCampaign(campaignId);
  const libImages = allMedia.filter((m) => m.kind === "image" && m.status === "completed");

  // live catalog / voices / credits are fetched async; bump this to re-render
  // the composer once each lands (the STUDIO getters read from cache).
  const [catalogVersion, setCatalogVersion] = React.useState(0);
  const [providerStatus, setProviderStatus] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    const bump = () => { if (alive) setCatalogVersion((v) => v + 1); };
    fetch("/api/media/providers", { headers: { Accept: "application/json" } })
      .then((r) => r.ok ? r.json() : null)
      .then((s) => { if (alive && s) setProviderStatus(s); })
      .catch(() => {});
    Promise.resolve(window.STUDIO.refreshModels()).then(bump);
    Promise.resolve(window.STUDIO.refreshVoices()).then(bump);
    Promise.resolve(window.STUDIO.refreshCredits()).then(bump);
    return () => { alive = false; };
  }, []);

  const [type, setType] = React.useState("image");
  const models = window.STUDIO.modelsByType(type);
  const [modelId, setModelId] = React.useState(() => {
    // Prefer the user's saved default image model; else a prompt-only model so
    // Generate works out of the box even when the live catalog is already loaded.
    const pref = type === "image" ? window.Store.getPref("defaultImageModelId") : null;
    const m = (pref && models.find((x) => x.id === pref)) || models.find((x) => !(x.requires && x.requires.startFrame)) || models[0];
    return m && m.id;
  });
  const model = window.STUDIO.getModel(modelId) || models[0];
  const voices = window.STUDIO.listVoices(model && model.provider);

  const [prompt, setPrompt] = React.useState("");
  const [aspect, setAspect] = React.useState((model && model.aspectRatios[0]) || "1:1");
  const [resolution, setResolution] = React.useState((model && model.resolutions[0]) || "720p");
  const [duration, setDuration] = React.useState((model && model.durations[0]) || 5);
  const [batch, setBatch] = React.useState(1);
  const [voiceId, setVoiceId] = React.useState((voices[0] || {}).id || "rachel");
  const [script, setScript] = React.useState("");
  const [voiceOn, setVoiceOn] = React.useState(false);
  const [startImage, setStartImage] = React.useState(null);
  const [keysOpen, setKeysOpen] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [prefillPiece, setPrefillPiece] = React.useState(null);
  // per-campaign learned image style
  const [style, setStyle] = React.useState({ knobs: { palette: "warm", mood: "neutral", finish: "photographic", detail: "balanced" }, directive: "", rounds: 0 });
  const [styleOpen, setStyleOpen] = React.useState(false);
  const [styleSeedJob, setStyleSeedJob] = React.useState(null);
  const [enhance, setEnhance] = React.useState(true); // art-direct image prompts
  const [directed, setDirected] = React.useState(""); // previewed/edited directed prompt
  const [directing, setDirecting] = React.useState(false);
  const [genScripting, setGenScripting] = React.useState(false); // voice "Generate script" busy
  const [scriptErr, setScriptErr] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    window.STUDIO.getStyle(campaignId).then((s) => { if (alive && s) setStyle(s); }).catch(() => {});
    return () => { alive = false; };
  }, [campaignId]);

  // reset model-dependent fields when type/model changes (or when the
  // live catalog arrives and replaces the static fallback)
  React.useEffect(() => {
    const list = window.STUDIO.modelsByType(type);
    if (!list.length) return;
    if (!list.some((m) => m.id === modelId)) {
      // Prefer the user's saved default image model, then a prompt-only model, so
      // a fresh Generate works without extra inputs. The dropdown still lists all.
      const pref = type === "image" ? window.Store.getPref("defaultImageModelId") : null;
      const def = (pref && list.find((m) => m.id === pref)) || list.find((m) => !(m.requires && m.requires.startFrame)) || list[0];
      setModelId(def.id);
    }
  }, [type, catalogVersion]);
  React.useEffect(() => {
    if (!model) return;
    if (model.aspectRatios.length && !model.aspectRatios.includes(aspect)) setAspect(model.aspectRatios[0]);
    if (model.resolutions.length && !model.resolutions.includes(resolution)) setResolution(model.resolutions[0]);
    if (model.durations.length && !model.durations.includes(duration)) setDuration(model.durations[0]);
    if (type === "avatar") setVoiceOn(true);
  }, [modelId]);

  // keep the selected voice valid once the live voice list arrives
  React.useEffect(() => {
    const vs = window.STUDIO.listVoices(model && model.provider);
    if (vs.length && !vs.some((v) => v.id === voiceId)) setVoiceId(vs[0].id);
  }, [catalogVersion, modelId]);

  // prefill from "→ Video" on an Outputs card
  React.useEffect(() => {
    const pf = window.__studioPrefill;
    if (pf) {
      window.__studioPrefill = null;
      setType(pf.type || "video");
      if (pf.prompt) setPrompt(pf.prompt);
      if (pf.script) { setScript(pf.script); setVoiceOn(true); }
      if (pf.pieceId) setPrefillPiece(pf.pieceId);
    }
  }, []);

  const req = (model && model.requires) || {};
  const isVoiceModel = type === "audio";
  const showVoiceover = type === "avatar" || (type === "video" && voiceOn);
  const estDuration = isVoiceModel ? window.STUDIO.estimateAudioDuration(prompt)
    : showVoiceover ? window.STUDIO.estimateAudioDuration(script) : duration;
  const cost = window.STUDIO.creditsCost(model, { resolution, duration, batch, estDuration, prompt });

  // Preview / regenerate the art-directed prompt without generating an image.
  const regenPrompt = async () => {
    setDirecting(true); setError(null);
    try {
      const r = await window.STUDIO.craftPrompt({ prompt, campaignId, pieceId: prefillPiece || undefined });
      if (r && r.prompt) setDirected(r.prompt);
    } catch (e) { setError((e && e.message) || "Couldn't draft the prompt."); }
    setDirecting(false);
  };

  // Voice: turn the linked piece into an ElevenLabs-ready script, into the Script field.
  const genScript = async () => {
    if (!prefillPiece) { setScriptErr("Pick a source piece first."); return; }
    setGenScripting(true); setScriptErr(null);
    try {
      const vName = (voices.find((v) => v.id === voiceId) || {}).name;
      const r = await window.STUDIO.craftVoiceScript({ pieceId: prefillPiece, campaignId, voiceName: vName });
      if (r && r.script) setPrompt(r.script);
      else setScriptErr("Couldn't generate a script.");
    } catch (e) { setScriptErr((e && e.message) || "Couldn't generate a script."); }
    setGenScripting(false);
  };

  const generate = () => {
    const usingDirected = type === "image" && directed.trim().length > 0;
    const effective = usingDirected ? directed.trim() : prompt;
    const params = { prompt: effective, aspect, resolution, duration, batch, voiceId, startImage, estDuration,
      audioRef: (type === "avatar" || (type === "video" && voiceOn)) ? "inline" : null };
    const err = window.STUDIO.validate(model, params);
    if (err) { setError(err); return; }
    setError(null);
    const media = window.Store.addMedia({
      // a staged/edited directed prompt is sent verbatim (enhance off); otherwise
      // the seed is art-directed server-side (enhance on).
      kind: type, prompt: usingDirected ? directed.trim() : (prompt || (isVoiceModel ? script : "")), modelId: model.id, modelName: model.name,
      provider: model.provider || "hedra",
      aspect: model.aspectRatios.length ? aspect : (type === "audio" ? null : aspect),
      resolution: model.resolutions.length ? resolution : null,
      duration: model.durations.length ? duration : null,
      voiceId: (isVoiceModel || showVoiceover) ? voiceId : null,
      audioScript: isVoiceModel ? prompt : (showVoiceover ? script : null),
      startImage: (type === "video" || type === "avatar" || (type === "image" && req.startFrame)) ? startImage : null,
      estDuration, creditsEst: cost, status: "queued", progress: 0,
      pieceId: prefillPiece || null,
      enhance: type === "image" ? (usingDirected ? false : enhance) : undefined,
      directed: usingDirected || undefined,
    });
    window.STUDIO.runJob(media, (patch) => window.Store.updateMedia(media.id, patch));
  };

  const regen = (m) => {
    const copy = window.Store.addMedia({ ...m, id: undefined, jobId: null, status: "queued", progress: 0, outputUrl: null, downloadUrl: null, thumbnailUrl: null, posterUrl: null, completedAt: null });
    window.STUDIO.runJob(copy, (patch) => window.Store.updateMedia(copy.id, patch));
  };
  const duplicate = (m) => { setType(m.kind); setPrompt(m.prompt || ""); if (m.audioScript) { setScript(m.audioScript); setVoiceOn(true); } if (m.voiceId) setVoiceId(m.voiceId); if (m.aspect) setAspect(m.aspect); window.scrollTo && window.scrollTo(0, 0); };
  const animate = (m) => { setType("video"); setStartImage(m.outputUrl); setPrompt(m.prompt || ""); };
  // Combine an existing image + an existing audio clip into a video (Hedra
  // image+audio model; duration auto-syncs to the audio).
  const combine = (image, audioId) => {
    const m = window.Store.addMedia({
      kind: "avatar", status: "queued", progress: 0,
      modelId: window.STUDIO.combineModelId(), modelName: "Image + audio",
      startImage: image.hedraAssetId || image.outputUrl,
      audioMediaId: audioId,
      pieceId: image.pieceId || null,
      prompt: "Combined image + audio → video",
    });
    window.STUDIO.runJob(m, (patch) => window.Store.updateMedia(m.id, patch));
  };

  const hedraOn = !!(providerStatus && providerStatus.hedra && providerStatus.hedra.configured);
  const elevenOn = !!(providerStatus && providerStatus.elevenlabs && providerStatus.elevenlabs.configured);
  const imageProviders = providerStatus && providerStatus.providers
    ? providerStatus.providers.filter((p) => p.configured && p.capabilities && p.capabilities.includes("image")).length
    : 0;

  return (
    <div className="scroll-y" style={{ flex: 1 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px 90px" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Hedra · ElevenLabs</div>
            <h1 style={{ fontSize: 42, letterSpacing: "-0.02em" }}>Studio</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <StatusChipMini ok={imageProviders > 0} label={imageProviders ? `${imageProviders} image provider${imageProviders === 1 ? "" : "s"}` : "Images not configured"} />
            <StatusChipMini ok={hedraOn} label={hedraOn ? "Video ready" : "Video not configured"} />
            <StatusChipMini ok={elevenOn} label={elevenOn ? "Voice ready" : "Voice not configured"} />
            <span className="chip" title="Available credits"><Icon name="sparkle" size={12} /> {window.STUDIO.getCredits().toLocaleString()} credits</span>
            <button className="btn sm" onClick={() => setKeysOpen(true)}><Icon name="key" size={13} /> Providers</button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 16, marginTop: 12, maxWidth: "60ch" }}>
          Generate imagery, animation, and voiced video for this campaign. Make a voiceover with ElevenLabs, then sync a Hedra avatar or animation to it — and attach the result to any piece.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "420px 1fr", gap: isMobile ? 18 : 32, alignItems: "start", marginTop: isMobile ? 18 : 26 }}>
          {/* composer */}
          <div className="card" style={{ padding: isMobile ? "16px 16px" : "20px 22px", position: isMobile ? "static" : "sticky", top: 20 }}>
            <div style={{ marginBottom: 18 }}>
              <Segmented value={type} onChange={setType} options={window.STUDIO.TYPES.map((t) => ({ v: t.id, l: t.label }))} />
            </div>

            {/* learned image-style strip */}
            {type === "image" && (
              <div style={{ marginBottom: 16, padding: "10px 12px", background: "var(--paper-sunk)", borderRadius: "var(--radius)", border: "1px solid var(--hair)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span className="eyebrow">Image style · round {style.rounds}</span>
                  <button className="btn ghost sm" onClick={() => { setStyleSeedJob(null); setStyleOpen(true); }}>Update preferences</button>
                </div>
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 6 }}>
                  {style.directive || "No learned style yet — rate a generation to start teaching the look."}
                </div>
              </div>
            )}

            {/* model selector (dropdown) */}
            <StField label="Model">
              <select className="field" value={modelId || ""} onChange={(e) => setModelId(e.target.value)}
                style={{ width: "100%", fontSize: 15, padding: "10px 12px", borderRadius: "var(--radius)" }}>
                {models.length === 0 && <option value="">No models available</option>}
                {(() => {
                  const opt = (m) => <option key={m.id} value={m.id}>{m.name}{m.credits ? " · " + m.credits + " cr" : ""}</option>;
                  const fromPrompt = models.filter((m) => !(m.requires && m.requires.startFrame));
                  const needStart = models.filter((m) => m.requires && m.requires.startFrame);
                  if (!fromPrompt.length || !needStart.length) return models.map(opt);
                  const labA = type === "image" ? "Text-to-image" : type === "video" ? "Text-to-video" : "From a prompt";
                  const labB = type === "image" ? "Image-to-image · needs a start image"
                    : type === "video" ? "Image-to-video · needs a start image" : "Needs a start image";
                  return [
                    <optgroup key="a" label={labA}>{fromPrompt.map(opt)}</optgroup>,
                    <optgroup key="b" label={labB}>{needStart.map(opt)}</optgroup>,
                  ];
                })()}
              </select>
              {model && model.description &&
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4, marginTop: 6 }}>{model.description}</div>}
              {type === "image" && model && (
                <div style={{ marginTop: 8 }}>
                  {window.Store.getPref("defaultImageModelId") === model.id
                    ? <span className="mono" style={{ fontSize: 11, color: "var(--st-approved)" }}>★ Default image model</span>
                    : <button className="btn ghost sm" onClick={() => { window.Store.setPref("defaultImageModelId", model.id); setCatalogVersion((v) => v + 1); }} title="Use this model by default for new image generations">★ Set as default</button>}
                </div>
              )}
            </StField>

            {/* prompt / script */}
            <StField label={isVoiceModel ? "Script" : type === "avatar" ? "Scene prompt" : "Prompt"}>
              <textarea className="field" value={prompt} onChange={(e) => setPrompt(e.target.value)}
                placeholder={isVoiceModel ? "What should the voice say?" : type === "image" ? "Describe the image…" : "Describe the shot / character…"}
                style={{ minHeight: 84, fontSize: 15, lineHeight: 1.55, resize: "vertical" }} />
              {isVoiceModel && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select className="field" value={prefillPiece || ""} onChange={(e) => setPrefillPiece(e.target.value || null)}
                      style={{ width: "auto", maxWidth: 300, fontSize: 13, padding: "6px 8px" }}>
                      <option value="">From piece… (source)</option>
                      {pieces.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                    </select>
                    <button className="btn ghost sm" onClick={genScript} disabled={genScripting || !prefillPiece}
                      title="Adapt the selected piece into a clean spoken script for ElevenLabs">
                      {genScripting ? <><Spinner size={13} /> Writing script…</> : <><Icon name="sparkle" size={13} /> Generate script</>}
                    </button>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                    {prefillPiece ? "Turns the linked piece into a narration-ready script (no markdown, TTS-safe)." : "Choose a piece to generate its voiceover script."}
                  </div>
                  {scriptErr && <div style={{ color: "var(--sev-must)", fontSize: 12.5, marginTop: 6 }}>{scriptErr}</div>}
                </div>
              )}
            </StField>

            {type === "image" && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <StToggle on={enhance} onChange={() => setEnhance((o) => !o)} />
                  <span style={{ fontSize: 14, lineHeight: 1.4 }}>Art-direct the prompt
                    <span className="muted"> — compose a cover-quality image from the article, brand, and learned style</span></span>
                </div>
                {enhance && (!directed ? (
                  <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={regenPrompt} disabled={directing}>
                    {directing ? <><Spinner size={13} /> Drafting…</> : <><Icon name="sparkle" size={13} /> Preview / regenerate prompt</>}
                  </button>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span className="eyebrow">Art-directed prompt · editable</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn ghost sm" onClick={regenPrompt} disabled={directing} title="Draft a fresh variation">{directing ? <Spinner size={12} /> : <Icon name="play" size={12} />} Regenerate</button>
                        <button className="btn ghost sm" onClick={() => setDirected("")} title="Drop back to art-directing from your seed">Clear</button>
                      </div>
                    </div>
                    <textarea className="field" value={directed} onChange={(e) => setDirected(e.target.value)}
                      style={{ width: "100%", minHeight: 92, fontSize: 13.5, lineHeight: 1.5, resize: "vertical" }} />
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>Generate will use this exact prompt.</div>
                  </div>
                ))}
              </div>
            )}

            {/* dynamic controls */}
            {model && model.aspectRatios.length > 0 && <StField label="Aspect ratio"><Segmented value={aspect} onChange={setAspect} options={model.aspectRatios} /></StField>}
            {model && model.resolutions.length > 0 && <StField label="Resolution"><Segmented value={resolution} onChange={setResolution} options={model.resolutions} /></StField>}
            {model && model.durations.length > 0 && <StField label="Duration"><Segmented value={duration} onChange={setDuration} options={model.durations.map((d) => ({ v: d, l: d + "s" }))} /></StField>}
            {type === "image" && <StField label="Batch"><Segmented value={batch} onChange={setBatch} options={[{ v: 1, l: "1" }, { v: 2, l: "2" }, { v: 4, l: "4" }]} /></StField>}

            {(type === "video" || type === "avatar" || (type === "image" && req.startFrame)) && (
              <StField label={type === "avatar" ? "Portrait image (start frame)" : "Start image"}>
                <StartImageField value={startImage} aspect={aspect} prompt={prompt} libraryImages={libImages} onChange={setStartImage} />
              </StField>
            )}

            {type === "video" && (
              <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                <StToggle on={voiceOn} onChange={() => setVoiceOn((o) => !o)} />
                <span style={{ fontSize: 14 }}>Add ElevenLabs voiceover &amp; sync</span>
              </div>
            )}

            {showVoiceover && (
              <>
                <StField label="Voice"><Segmented value={voiceId} onChange={setVoiceId} options={voices.map((v) => ({ v: v.id, l: v.name }))} /></StField>
                <StField label="Voiceover script">
                  <textarea className="field" value={script} onChange={(e) => setScript(e.target.value)} placeholder="What the voice says, synced to the video…" style={{ minHeight: 70, fontSize: 15, resize: "vertical" }} />
                </StField>
              </>
            )}
            {isVoiceModel && <StField label="Voice"><Segmented value={voiceId} onChange={setVoiceId} options={voices.map((v) => ({ v: v.id, l: v.name }))} /></StField>}

            {prefillPiece && <div className="mono" style={{ fontSize: 11, color: "var(--accent-ink)", marginBottom: 10 }}>↳ will attach to: {(pieces.find((p) => p.id === prefillPiece) || {}).title}</div>}

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
              <button className="btn primary" onClick={generate}><Icon name="sparkle" size={15} /> Generate</button>
              <span className="mono muted" style={{ fontSize: 12 }}>~{cost} credits</span>
            </div>
            {error && <p style={{ color: "var(--sev-must)", fontSize: 13.5, marginTop: 12 }}>{error}</p>}
          </div>

          {/* library */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="eyebrow">Media library · {allMedia.length}</div>
            </div>
            <MediaLibrary items={allMedia} pieces={pieces}
              audios={allMedia.filter((m) => m.kind === "audio" && m.status === "completed")}
              empty="Nothing generated yet. Make an image or a voiced video on the left."
              onAttach={(id, pid) => window.Store.attachMediaToPiece(id, pid)}
              onCombine={combine}
              onRegen={regen} onDuplicate={duplicate} onDelete={(m) => window.Store.removeMedia(m.id)} onAnimate={animate}
              onTuneStyle={(m) => { setStyleSeedJob(m.id); setStyleOpen(true); }} />
          </div>
        </div>
        {keysOpen && <MediaProvidersDialog status={providerStatus} onClose={() => setKeysOpen(false)} />}
        {styleOpen && <StyleSurveyModal campaignId={campaignId} profile={style} mediaJobId={styleSeedJob}
          onClose={() => setStyleOpen(false)} onSaved={(p) => { setStyle(p); setStyleOpen(false); }} />}
      </div>
    </div>
  );
}

Object.assign(window, { Studio, MediaProvidersDialog });
