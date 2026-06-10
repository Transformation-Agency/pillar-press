/* Shared read-aloud and audio-save controls for drafts, revisions, and outputs. */

function AudioActions({ text, label = "text", filename = "audio.mp3", pieceId = null, campaignId = null }) {
  const [playing, setPlaying] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const playerRef = React.useRef(null);

  const readText = () => (typeof text === "function" ? text() : text || "").trim();

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
    setMsg("Preparing ElevenLabs audio...");
    try {
      const voiceRes = await fetch("/api/eleven/voices", { headers: { Accept: "application/json" } });
      const voiceJson = await voiceRes.json().catch(() => null);
      if (!voiceRes.ok) throw new Error((voiceJson && voiceJson.error) || "Connect ElevenLabs to save audio.");
      const voices = voiceJson && (voiceJson.voices || voiceJson);
      const voice = Array.isArray(voices) && voices[0];
      const voiceId = voice && (voice.id || voice.voice_id || voice.voiceId);
      if (!voiceId) throw new Error("No ElevenLabs voices were found.");

      const activeCampaign = window.Store && window.Store.activeCampaign && window.Store.activeCampaign();
      const res = await fetch("/api/hedra/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          type: "audio",
          modelId: "eleven_multilingual_v2",
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
      setMsg("Audio saved" + (voice.name ? " with " + voice.name : "") + ".");
      if (outputUrl) {
        const a = document.createElement("a");
        a.href = outputUrl;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
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
      <button className="btn ghost sm" onClick={saveAudio} disabled={saving || !readText()} title={"Save " + label + " as ElevenLabs audio"}>
        {saving ? <><Spinner size={13} /> Saving...</> : <><Icon name="doc" size={14} /> Save audio</>}
      </button>
      {msg && <span className="muted" style={{ fontSize: 12.5 }}>{msg}</span>}
    </div>
  );
}

Object.assign(window, { AudioActions });
