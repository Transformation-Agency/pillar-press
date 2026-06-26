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
    setMsg("Preparing audio...");
    try {
      const activeCampaign = window.Store && window.Store.activeCampaign && window.Store.activeCampaign();
      const providerRes = await fetch("/api/media/providers", { headers: { Accept: "application/json" } });
      const providerJson = await providerRes.json().catch(() => null);
      const providers = providerJson && Array.isArray(providerJson.providers) ? providerJson.providers : [];
      const openai = providers.find((p) => p && p.id === "openai" && p.configured);
      const openaiAudioModel = openai && Array.isArray(openai.models)
        ? openai.models.find((m) => m && m.type === "audio")
        : null;
      const openaiProfileId = openaiAudioModel && openaiAudioModel.profileId
        ? openaiAudioModel.profileId
        : openai && Array.isArray(openai.profileIds)
          ? openai.profileIds[0]
          : null;
      let requestBody;
      let voiceName = "";
      if (openai && openaiAudioModel) {
        requestBody = {
          type: "audio",
          provider: "openai",
          mediaProfileId: openaiProfileId || undefined,
          modelId: openaiAudioModel.id || "gpt-4o-mini-tts",
          script: body,
          prompt: body.slice(0, 2000),
          voiceId: "alloy",
          pieceId,
          campaignId: campaignId || (activeCampaign && activeCampaign.id) || undefined,
        };
        voiceName = "OpenAI";
      } else {
        const eleven = providers.find((p) => p && p.id === "elevenlabs" && p.configured);
        if (eleven) {
          const voiceRes = await fetch("/api/eleven/voices", { headers: { Accept: "application/json" } });
          const voiceJson = await voiceRes.json().catch(() => null);
          if (!voiceRes.ok) throw new Error((voiceJson && voiceJson.error) || "Connect OpenAI media or ElevenLabs to save audio.");
          const voices = voiceJson && (voiceJson.voices || voiceJson);
          const voice = Array.isArray(voices) && voices[0];
          const voiceId = voice && (voice.id || voice.voice_id || voice.voiceId);
          if (!voiceId) throw new Error("No saved audio voices were found.");
          requestBody = {
            type: "audio",
            provider: "elevenlabs",
            mediaProfileId: eleven && Array.isArray(eleven.profileIds) ? eleven.profileIds[0] : undefined,
            modelId: "eleven_multilingual_v2",
            script: body,
            prompt: body.slice(0, 2000),
            voiceId,
            pieceId,
            campaignId: campaignId || (activeCampaign && activeCampaign.id) || undefined,
          };
          voiceName = voice.name || "ElevenLabs";
        } else {
          requestBody = {
            type: "audio",
            provider: "local-system",
            modelId: "macos-system-voice",
            script: body,
            prompt: body.slice(0, 2000),
            voiceId: "system-default",
            pieceId,
            campaignId: campaignId || (activeCampaign && activeCampaign.id) || undefined,
          };
          voiceName = "Mac";
        }
      }
      const res = await fetch("/api/hedra/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || "Could not save audio.");
      const job = data && data.job;
      const outputUrl = job && (job.downloadUrl || job.outputUrl);
      setMsg("Audio saved" + (voiceName ? " with " + voiceName : "") + ".");
      if (outputUrl) {
        const a = document.createElement("a");
        a.href = outputUrl;
        a.download = job && job.meta && job.meta.extension === "aiff" ? filename.replace(/\.[^.]+$/, ".aiff") : filename;
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
      <button className="btn ghost sm" onClick={saveAudio} disabled={saving || !readText()} title={"Save " + label + " as an audio file"}>
        {saving ? <><Spinner size={13} /> Saving...</> : <><Icon name="doc" size={14} /> Save audio</>}
      </button>
      {msg && <span className="muted" style={{ fontSize: 12.5 }}>{msg}</span>}
    </div>
  );
}

Object.assign(window, { AudioActions });
