/* Media components — previews (image / live voice / synced video),
   cards, and a reusable library/picker. Used by Studio and the
   per-piece Media tab. Exports to window. */

const MEDIA_STATUS = {
  queued: { label: "Queued", c: "--ink-3" },
  processing: { label: "Processing", c: "--sev-consider" },
  completed: { label: "Completed", c: "--st-approved" },
  failed: { label: "Failed", c: "--sev-must" },
  canceled: { label: "Canceled", c: "--ink-3" },
};

function aspectPad(aspect) {
  const d = (window.STUDIO.ASPECT_DIM[aspect] || [1, 1]);
  return (d[1] / d[0]) * 100;
}

function AspectBox({ aspect, children, style }) {
  return (
    <div style={{ position: "relative", width: "100%", paddingTop: aspectPad(aspect || "1:1") + "%", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--paper-sunk)", ...style }}>
      <div style={{ position: "absolute", inset: 0 }}>{children}</div>
    </div>
  );
}

function ImagePreview({ media }) {
  return <AspectBox aspect={media.aspect}><img src={media.outputUrl} alt={media.prompt || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></AspectBox>;
}

function Waveform({ active }) {
  const bars = 28;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 34 }}>
      {Array.from({ length: bars }).map((_, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 3, background: active ? "var(--accent)" : "var(--hair-2)",
          height: active ? `${20 + Math.abs(Math.sin(i * 1.3)) * 60}%` : "26%",
          animation: active ? `wf 0.9s ${i * 0.04}s ease-in-out infinite alternate` : "none",
        }} />
      ))}
      <style>{`@keyframes wf{from{transform:scaleY(0.4)}to{transform:scaleY(1)}}`}</style>
    </div>
  );
}

function AudioPreview({ media, compact }) {
  const [playing, setPlaying] = React.useState(false);
  const audioRef = React.useRef(null);
  const script = media.prompt || media.audioScript || "";
  const voices = window.STUDIO.listVoices();
  const voice = (voices.find((v) => v.id === media.voiceId) || voices[0] || { name: "Voice" });
  // a real rendered track has an http(s) audio url; otherwise preview via TTS
  const realUrl = (media.outputUrl || media.downloadUrl);
  const isReal = !!realUrl && /^https?:/i.test(realUrl);
  const toggle = () => {
    if (isReal) {
      const el = audioRef.current; if (!el) return;
      if (playing) { el.pause(); setPlaying(false); }
      else { el.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
      return;
    }
    if (playing) { window.STUDIO.stopSpeak(); setPlaying(false); return; }
    window.STUDIO.speak(script, media.voiceId, { onstart: () => setPlaying(true), onend: () => setPlaying(false), onerror: () => setPlaying(false) });
  };
  React.useEffect(() => () => window.STUDIO.stopSpeak(), []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: compact ? "4px 0" : "14px 16px", background: compact ? "transparent" : "var(--paper-sunk)", borderRadius: "var(--radius)" }}>
      <button onClick={toggle} className="icon-btn" style={{ width: 42, height: 42, flexShrink: 0, background: "var(--accent)", color: "oklch(0.99 0.01 80)", border: "none" }}>
        <Icon name={playing ? "pause" : "play"} size={18} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Waveform active={playing} />
      </div>
      <div className="mono muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{voice.name} · ~{media.estDuration || window.STUDIO.estimateAudioDuration(script)}s</div>
      {isReal && <audio ref={audioRef} src={realUrl} onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} style={{ display: "none" }} />}
    </div>
  );
}

function VideoPreview({ media }) {
  const [playing, setPlaying] = React.useState(false);
  const [capIdx, setCapIdx] = React.useState(-1);
  const timers = React.useRef([]);
  const script = media.audioScript || "";
  const dur = media.estDuration || media.duration || 8;
  const caps = React.useMemo(() => {
    if (!script) return [];
    const words = script.split(/\s+/); const out = []; for (let i = 0; i < words.length; i += 6) out.push(words.slice(i, i + 6).join(" "));
    return out;
  }, [script]);

  const clearTimers = () => { timers.current.forEach((t) => clearTimeout(t)); timers.current = []; };
  const stop = () => { clearTimers(); window.STUDIO.stopSpeak(); setPlaying(false); setCapIdx(-1); };
  React.useEffect(() => () => stop(), []);

  const play = () => {
    if (playing) { stop(); return; }
    setPlaying(true);
    if (caps.length) {
      const per = (dur * 1000) / caps.length;
      caps.forEach((_, i) => timers.current.push(setTimeout(() => setCapIdx(i), per * i)));
    }
    if (script) {
      window.STUDIO.speak(script, media.voiceId, { onend: stop, onerror: stop });
      timers.current.push(setTimeout(stop, dur * 1000 + 1500));
    } else {
      timers.current.push(setTimeout(stop, dur * 1000));
    }
  };

  // A real rendered video has an http(s) outputUrl distinct from its poster
  // image. Play it natively; otherwise fall back to the synced poster/TTS demo.
  const isRealVideo = !!media.outputUrl && /^https?:/i.test(media.outputUrl) && media.outputUrl !== media.posterUrl && !/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(media.outputUrl);
  if (isRealVideo) {
    return (
      <AspectBox aspect={media.aspect}>
        <video src={media.outputUrl} poster={media.posterUrl || media.thumbnailUrl || undefined} controls
          style={{ width: "100%", height: "100%", objectFit: "cover", background: "black" }} />
        {media.kind === "avatar" && <span className="mono" style={{ position: "absolute", top: 10, left: 10, fontSize: 10, padding: "3px 7px", borderRadius: 99, background: "oklch(0.16 0.01 60 / 0.55)", color: "white" }}>lip-sync</span>}
      </AspectBox>
    );
  }

  return (
    <AspectBox aspect={media.aspect}>
      <img src={media.posterUrl || media.outputUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", transformOrigin: "60% 40%", animation: playing ? `kenburns ${dur}s ease-in-out forwards` : "none" }} />
      <style>{`@keyframes kenburns{from{transform:scale(1.02)}to{transform:scale(1.16) translate(-3%,-2%)}}`}</style>
      {/* captions */}
      {playing && capIdx >= 0 && caps[capIdx] && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: "9%", textAlign: "center", padding: "0 8%" }}>
          <span style={{ background: "oklch(0.16 0.01 60 / 0.7)", color: "white", padding: "5px 12px", borderRadius: 6, fontSize: 16, lineHeight: 1.5, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone", fontFamily: "var(--font-body)" }}>{caps[capIdx]}</span>
        </div>
      )}
      {/* play overlay */}
      <button onClick={play} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", border: "none", background: playing ? "transparent" : "oklch(0.16 0.01 60 / 0.18)", cursor: "pointer" }}>
        {!playing && <span style={{ width: 58, height: 58, borderRadius: 999, background: "oklch(0.16 0.01 60 / 0.55)", display: "grid", placeItems: "center", color: "white", backdropFilter: "blur(2px)" }}><Icon name="play" size={24} /></span>}
        {playing && <span style={{ position: "absolute", top: 10, right: 10, width: 30, height: 30, borderRadius: 999, background: "oklch(0.16 0.01 60 / 0.55)", display: "grid", placeItems: "center", color: "white" }}><Icon name="pause" size={15} /></span>}
      </button>
      {/* progress */}
      {playing && <div style={{ position: "absolute", left: 0, bottom: 0, height: 3, background: "var(--accent)", animation: `growbar ${dur}s linear forwards` }} />}
      <style>{`@keyframes growbar{from{width:0}to{width:100%}}`}</style>
      {media.kind === "avatar" && <span className="mono" style={{ position: "absolute", top: 10, left: 10, fontSize: 10, padding: "3px 7px", borderRadius: 99, background: "oklch(0.16 0.01 60 / 0.55)", color: "white" }}>lip-sync</span>}
    </AspectBox>
  );
}

function MediaPreview({ media }) {
  if (media.status !== "completed") {
    return (
      <AspectBox aspect={media.aspect || "1:1"}>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", gap: 12 }}>
          {media.status === "failed"
            ? <div style={{ textAlign: "center", color: "var(--sev-must)" }}><Icon name="warn" size={22} /><div style={{ fontSize: 13, marginTop: 6, maxWidth: 220 }}>{media.error || "Generation failed."}</div></div>
            : <div style={{ textAlign: "center" }}><Spinner size={22} /><div className="mono muted" style={{ fontSize: 12, marginTop: 8 }}>{(MEDIA_STATUS[media.status] || {}).label} · {media.progress || 0}%</div>
                <div style={{ width: 120, height: 3, background: "var(--hair)", borderRadius: 9, marginTop: 8, overflow: "hidden" }}><div style={{ height: 3, width: (media.progress || 0) + "%", background: "var(--accent)", transition: "width 0.2s" }} /></div></div>}
        </div>
      </AspectBox>
    );
  }
  if (media.kind === "image") return <ImagePreview media={media} />;
  if (media.kind === "audio") return <AudioPreview media={media} />;
  return <VideoPreview media={media} />;
}

function MediaCard({ media, pieces, onAttach, onRegen, onDuplicate, onDelete, onAnimate, onTuneStyle }) {
  const [attachOpen, setAttachOpen] = React.useState(false);
  const st = MEDIA_STATUS[media.status] || MEDIA_STATUS.queued;
  const model = window.STUDIO.getModel(media.modelId);
  const attached = media.pieceId && pieces && pieces.find((p) => p.id === media.pieceId);
  const download = () => {
    const url = media.downloadUrl || media.outputUrl || media.posterUrl;
    if (!url) return;
    if (url.startsWith("data:")) {
      window.EXPORT.downloadBlob(dataURItoBlob(url), window.EXPORT.safeName((media.prompt || media.kind).slice(0, 30)) + ".svg");
    } else {
      // real remote asset (mp4/png/mp3) — open/download via the browser
      const a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.download = window.EXPORT.safeName((media.prompt || media.kind).slice(0, 30));
      document.body.appendChild(a); a.click(); a.remove();
    }
  };
  return (
    <div className="card" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 10 }}><MediaPreview media={media} /></div>
      <div style={{ padding: "4px 14px 14px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: `var(${st.c})`, flexShrink: 0 }} />
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: `var(${st.c})` }}>{media.kind} · {st.label}</span>
          <span className="mono muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>{model ? model.name.split("·").pop().trim() : ""}</span>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink-2)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{media.prompt || media.title || "—"}</div>
        {attached && <div className="mono" style={{ fontSize: 10.5, color: "var(--accent-ink)" }}>↳ {attached.title}</div>}
        {media.status === "completed" && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2, position: "relative" }}>
            {onAnimate && media.kind === "image" && <button className="btn ghost sm" onClick={() => onAnimate(media)} title="Animate into video"><Icon name="play" size={13} /> Animate</button>}
            {onTuneStyle && media.kind === "image" && <button className="btn ghost sm" onClick={() => onTuneStyle(media)} title="Teach this campaign's image style from this result"><Icon name="sparkle" size={13} /> Tune style</button>}
            {onAttach && <button className="btn ghost sm" onClick={() => setAttachOpen((o) => !o)}><Icon name="book" size={13} /> Attach</button>}
            {onRegen && <button className="btn ghost sm" onClick={() => onRegen(media)} title="Regenerate"><Icon name="play" size={13} /></button>}
            {onDuplicate && <button className="btn ghost sm" onClick={() => onDuplicate(media)} title="Duplicate prompt"><Icon name="copy" size={13} /></button>}
            {(media.downloadUrl || media.outputUrl || media.posterUrl) && <button className="btn ghost sm" onClick={download} title="Download"><Icon name="doc" size={13} /></button>}
            {onDelete && <button className="btn ghost sm" onClick={() => onDelete(media)} title="Delete"><Icon name="trash" size={13} /></button>}
            {attachOpen && onAttach && (
              <div className="card" style={{ position: "absolute", top: 32, left: 0, zIndex: 30, width: 220, maxHeight: 240, overflowY: "auto", padding: 6, boxShadow: "var(--shadow-lg)" }}>
                <div className="eyebrow" style={{ padding: "4px 8px" }}>Attach to piece</div>
                {(pieces || []).length === 0 && <div className="muted" style={{ fontSize: 13, padding: "4px 8px", fontStyle: "italic" }}>No pieces in this campaign.</div>}
                {(pieces || []).map((p) => (
                  <button key={p.id} onClick={() => { onAttach(media.id, p.id); setAttachOpen(false); }}
                    style={{ width: "100%", textAlign: "left", border: "none", background: media.pieceId === p.id ? "var(--accent-soft)" : "transparent", cursor: "pointer", borderRadius: 6, padding: "8px 9px", fontSize: 13.5, color: "var(--ink)" }}>{p.title}</button>
                ))}
                {media.pieceId && <button onClick={() => { onAttach(media.id, null); setAttachOpen(false); }} className="mono" style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", borderRadius: 6, padding: "8px 9px", fontSize: 11, color: "var(--ink-3)" }}>DETACH</button>}
              </div>
            )}
          </div>
        )}
        {media.status === "processing" && <button className="btn ghost sm" onClick={() => onDelete && onDelete(media)} style={{ alignSelf: "flex-start" }}>Cancel</button>}
      </div>
    </div>
  );
}

function dataURItoBlob(uri) {
  if (uri.startsWith("data:image/svg+xml")) {
    const svg = decodeURIComponent(uri.split(",")[1]);
    return new Blob([svg], { type: "image/svg+xml" });
  }
  const [meta, b64] = uri.split(",");
  const mime = (meta.match(/:(.*?);/) || [])[1] || "application/octet-stream";
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function MediaLibrary({ items, pieces, empty, ...handlers }) {
  if (!items.length) return <div style={{ padding: "44px 24px", textAlign: "center", border: "1px dashed var(--hair-2)", borderRadius: "var(--radius-lg)" }}><p className="muted" style={{ fontStyle: "italic", margin: 0 }}>{empty || "No media yet."}</p></div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
      {items.map((m) => <MediaCard key={m.id} media={m} pieces={pieces} {...handlers} />)}
    </div>
  );
}

Object.assign(window, { MediaPreview, MediaCard, MediaLibrary, ImagePreview, AudioPreview, VideoPreview, AspectBox, MEDIA_STATUS, dataURItoBlob });
