/* Shared read-aloud and audio-save controls for drafts, revisions, and outputs. */

function AudioActions({ text, label = "text", filename = "audio.mp3", pieceId = null, campaignId = null }) {
  const [playing, setPlaying] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const playerRef = React.useRef(null);

  const readText = () => (typeof text === "function" ? text() : text || "").trim();

  const blobBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve(dataUrl.includes(",") ? dataUrl.split(",").pop() : dataUrl);
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read audio file."));
    reader.readAsDataURL(blob);
  });

  const browserDownload = (url) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const saveOutputUrl = async (outputUrl) => {
    const desktop = window.PILLAR_DESKTOP;
    const tauriInvoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    const isDesktop = !!((desktop && desktop.isDesktop && desktop.isDesktop()) || tauriInvoke);
    if (isDesktop) {
      const audioRes = await fetch(outputUrl);
      if (!audioRes.ok) throw new Error("Could not download the generated audio.");
      const blob = await audioRes.blob();
      const base64 = await blobBase64(blob);
      if (desktop && desktop.saveAudioFile) return desktop.saveAudioFile(filename, base64);
      if (tauriInvoke) return tauriInvoke("save_audio_file", { args: { filename, base64 } });
      throw new Error("Desktop save is not available. Reload Pillar Press and try again.");
    }
    browserDownload(outputUrl);
    return { path: filename };
  };

  const loadAudioProvider = async () => {
    const res = await fetch("/api/media/providers", { headers: { Accept: "application/json" }, cache: "no-store" });
    const status = await res.json().catch(() => null);
    if (!res.ok) throw new Error((status && status.error) || "Could not read voice provider setup.");
    const providers = Array.isArray(status && status.providers) ? status.providers : [];
    const configuredAudio = providers.filter((provider) =>
      provider &&
      provider.configured &&
      Array.isArray(provider.capabilities) &&
      provider.capabilities.includes("audio")
    );
    const provider = configuredAudio.find((item) => item.id === "openai") || configuredAudio[0];
    if (!provider) throw new Error("Connect a voice provider to save audio.");
    const models = Array.isArray(provider.models) ? provider.models.filter((model) => model && model.type === "audio") : [];
    return { provider, model: models[0] || null };
  };

  const loadElevenVoice = async () => {
    const voiceRes = await fetch("/api/eleven/voices", { headers: { Accept: "application/json" }, cache: "no-store" });
    const voiceJson = await voiceRes.json().catch(() => null);
    if (!voiceRes.ok) throw new Error((voiceJson && voiceJson.error) || "Connect a voice provider to save audio.");
    const voices = voiceJson && (voiceJson.voices || voiceJson);
    const voice = Array.isArray(voices) && voices[0];
    const voiceId = voice && (voice.id || voice.voice_id || voice.voiceId);
    if (!voiceId) throw new Error("No saved voices were found.");
    return voice;
  };

  const playAloud = () => {
    const body = readText();
    if (!body) return;
    setMsg("");
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch (_err) {}
      playerRef.current = null;
    }
    if (window.speechSynthesis) {
      try {
        if (playing) {
          window.speechSynthesis.cancel();
          setPlaying(false);
          return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(body.slice(0, 12000));
        utterance.onend = () => setPlaying(false);
        utterance.onerror = () => { setPlaying(false); setMsg("Could not play this aloud."); };
        setPlaying(true);
        window.speechSynthesis.speak(utterance);
      } catch (_err) {
        setPlaying(false);
        setMsg("Speech is not available here.");
      }
    } else {
      setMsg("Speech is not available here.");
    }
  };

  const saveAudio = async () => {
    const body = readText();
    if (!body || saving) return;
    setSaving(true);
    setMsg("Preparing audio...");
    try {
      const { provider, model } = await loadAudioProvider();
      let voice = null;
      let voiceId = "alloy";
      if (provider.id === "elevenlabs") {
        voice = await loadElevenVoice();
        voiceId = voice && (voice.id || voice.voice_id || voice.voiceId);
      }

      const activeCampaign = window.Store && window.Store.activeCampaign && window.Store.activeCampaign();
      const res = await fetch("/api/hedra/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          type: "audio",
          provider: provider.id,
          modelId: (model && model.id) || (provider.id === "openai" ? "gpt-4o-mini-tts" : "eleven_multilingual_v2"),
          script: body,
          prompt: body.slice(0, 2000),
          voiceId,
          pieceId,
          campaignId: campaignId || (activeCampaign && activeCampaign.id) || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || "Could not save audio.");
      const job = data && data.job;
      const outputUrl = job && (job.downloadUrl || job.outputUrl);
      if (outputUrl) {
        setMsg("Choose where to save the audio...");
        await saveOutputUrl(outputUrl);
      }
      setMsg("Audio saved" + (voice && voice.name ? " with " + voice.name : " with " + provider.label) + ".");
      if (window.Store && window.Store.refreshMedia) window.Store.refreshMedia();
    } catch (e) {
      setMsg((e && e.message) || "Could not save audio.");
    }
    setSaving(false);
  };

  React.useEffect(() => () => {
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_err) {}
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch (_err) {}
    }
  }, []);

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn ghost sm" onClick={playAloud} title={"Play " + label + " aloud with local/browser speech"}>
        <Icon name="play" size={14} /> {playing ? "Stop" : "Play aloud"}
      </button>
      <button className="btn ghost sm" onClick={saveAudio} disabled={saving || !readText()} title={"Save " + label + " as audio using your configured voice provider"}>
        {saving ? <><Spinner size={13} /> Saving...</> : <><Icon name="doc" size={14} /> Save audio</>}
      </button>
      {msg && <span className="muted" style={{ fontSize: 12.5 }}>{msg}</span>}
    </div>
  );
}

Object.assign(window, { AudioActions });
