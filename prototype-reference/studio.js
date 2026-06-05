/* ============================================================
   Studio — Hedra + ElevenLabs media engine for the in-app
   prototype. Generation is SIMULATED so it runs in the browser
   with no server/keys/CORS: images become styled placeholders,
   ElevenLabs voice uses the browser speech engine (real audio),
   and Hedra video is the start image animated in sync with that
   audio. The production server-side version lives in /handoff.
   Plain JS. Exposes window.STUDIO.
   ============================================================ */
(function () {

  // ---- Fallback model catalog (server build calls Hedra listModels()) ----
  const MODELS = [
    { id: "hedra-image-1", name: "Hedra Image", type: "image", credits: 6,
      description: "Text-to-image for post art, hooks, and thumbnails.",
      aspectRatios: ["1:1", "4:5", "16:9", "9:16"], resolutions: ["720p", "1080p"], durations: [],
      requires: { prompt: true } },
    { id: "hedra-character-3-i2v", name: "Character-3 · Image→Video", type: "video", credits: 40,
      description: "Animate a start image into short motion video. Optional audio as soundtrack.",
      aspectRatios: ["16:9", "9:16", "1:1"], resolutions: ["540p", "720p", "1080p"], durations: [3, 5, 8, 10], maxDuration: 30,
      requires: { prompt: true, startFrame: true, audio: false, endFrame: false } },
    { id: "hedra-character-3-avatar", name: "Character-3 · Avatar", type: "avatar", credits: 60,
      description: "Talking-head video: a portrait image lip-synced to an audio track.",
      aspectRatios: ["9:16", "1:1", "16:9"], resolutions: ["540p", "720p"], durations: [], maxDuration: 120,
      requires: { startFrame: true, audio: true } },
    { id: "eleven-tts-multilingual-v2", name: "ElevenLabs · Multilingual v2", type: "audio", credits: 1,
      description: "Natural voiceover from a script. The audio you can sync video to.",
      aspectRatios: [], resolutions: [], durations: [],
      requires: { prompt: true, voice: true } },
  ];

  const VOICES = [
    { id: "rachel", name: "Rachel", desc: "Warm, conversational", gender: "female", rate: 1.0, pitch: 1.05 },
    { id: "bella", name: "Bella", desc: "Soft, reflective", gender: "female", rate: 0.95, pitch: 1.15 },
    { id: "domi", name: "Domi", desc: "Bright, energetic", gender: "female", rate: 1.08, pitch: 1.2 },
    { id: "adam", name: "Adam", desc: "Deep, grounded", gender: "male", rate: 0.96, pitch: 0.85 },
    { id: "antoni", name: "Antoni", desc: "Calm, measured", gender: "male", rate: 0.98, pitch: 0.95 },
    { id: "arnold", name: "Arnold", desc: "Documentary narration", gender: "male", rate: 0.92, pitch: 0.9 },
  ];

  const TYPES = [
    { id: "image", label: "Image" },
    { id: "video", label: "Animate" },
    { id: "avatar", label: "Avatar" },
    { id: "audio", label: "Voice" },
  ];

  function listModels(types) { return types ? MODELS.filter((m) => types.includes(m.type)) : MODELS.slice(); }
  function modelsByType(type) { return MODELS.filter((m) => m.type === type); }
  function getModel(id) { return MODELS.find((m) => m.id === id) || null; }
  function listVoices() { return VOICES.slice(); }
  function getCredits() { const s = window.Store && window.Store.getSettings(); return (s && s.hedra && s.hedra.apiKey) ? 5000 : 1240; }

  function hashStr(s) { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

  const ASPECT_DIM = { "1:1": [600, 600], "4:5": [560, 700], "16:9": [800, 450], "9:16": [450, 800], "4:3": [720, 540] };

  // styled SVG placeholder standing in for a generated image
  function makeImagePlaceholder(prompt, aspect, kind) {
    const [w, h] = ASPECT_DIM[aspect] || [600, 600];
    const seed = hashStr(prompt + aspect);
    const hue1 = seed % 360, hue2 = (hue1 + 40) % 360;
    const c1 = `oklch(0.55 0.11 ${hue1})`, c2 = `oklch(0.42 0.09 ${hue2})`, c3 = `oklch(0.72 0.08 ${hue1})`;
    const label = (prompt || "").slice(0, 64).replace(/[<&>]/g, "");
    const svg =
`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
<stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient>
<pattern id='p' width='14' height='14' patternUnits='userSpaceOnUse' patternTransform='rotate(35)'>
<rect width='14' height='14' fill='transparent'/><line x1='0' y1='0' x2='0' y2='14' stroke='${c3}' stroke-opacity='0.18' stroke-width='6'/></pattern></defs>
<rect width='${w}' height='${h}' fill='url(#g)'/><rect width='${w}' height='${h}' fill='url(#p)'/>
<circle cx='${w * 0.72}' cy='${h * 0.3}' r='${Math.min(w, h) * 0.16}' fill='${c3}' fill-opacity='0.5'/>
<text x='24' y='${h - 54}' font-family='IBM Plex Mono, monospace' font-size='13' fill='white' fill-opacity='0.7'>${kind} · ${aspect}</text>
<text x='24' y='${h - 30}' font-family='Newsreader, serif' font-size='20' fill='white'>${label}</text>
</svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }

  function estimateAudioDuration(text) {
    const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(2, Math.round((words / 2.6) * 10) / 10); // ~156 wpm
  }

  function creditsCost(model, params) {
    if (!model) return 0;
    let c = model.credits || 0;
    const resMult = { "540p": 1, "720p": 1.4, "1080p": 2 }[params.resolution] || 1;
    if (model.type === "video") c = Math.round(c * resMult * ((params.duration || 5) / 5));
    else if (model.type === "avatar") c = Math.round(c * resMult * Math.max(1, (params.estDuration || 8) / 8));
    else if (model.type === "image") c = Math.round(c * resMult * (params.batch || 1));
    else if (model.type === "audio") c = Math.max(1, Math.round((params.estDuration || estimateAudioDuration(params.prompt)) / 5));
    return c;
  }

  // input validation against model metadata + safe user-facing errors
  function validate(model, params) {
    if (!model) return "Pick a model first.";
    const r = model.requires || {};
    if (r.prompt && (!params.prompt || params.prompt.trim().length < 3)) return "Add a prompt of at least 3 characters.";
    if ((params.prompt || "").length > 2000) return "Prompt is too long (max 2000 characters).";
    if (r.startFrame && !params.startImage) return "This model needs a start image. Upload or pick one.";
    if (r.endFrame && !params.endImage) return "This model needs an end image.";
    if (r.audio && !params.audioRef) return "This avatar model needs an audio track. Generate or pick a voiceover first.";
    if (r.voice && !params.voiceId) return "Choose a voice.";
    if (model.aspectRatios && model.aspectRatios.length && params.aspect && !model.aspectRatios.includes(params.aspect)) return "That aspect ratio isn't supported by this model.";
    if (model.maxDuration && params.duration && params.duration > model.maxDuration) return `Max duration for this model is ${model.maxDuration}s.`;
    return null;
  }

  // ---- simulated async job runner ----
  // Advances queued -> processing(progress) -> completed, mirroring the
  // real poll loop. Returns a cancel function.
  function runJob(media, onUpdate) {
    let cancelled = false;
    const speed = media.kind === "image" ? 1 : media.kind === "audio" ? 0.7 : 1.6; // seconds-ish
    const total = 1600 * speed;
    const t0 = Date.now();
    onUpdate({ status: "queued", progress: 0 });
    const startDelay = setTimeout(() => {
      if (cancelled) return;
      onUpdate({ status: "processing", progress: 2 });
      const iv = setInterval(() => {
        if (cancelled) { clearInterval(iv); return; }
        const p = Math.min(99, Math.round(((Date.now() - t0) / total) * 100));
        if (p >= 99) {
          clearInterval(iv);
          finish(media, onUpdate);
        } else { onUpdate({ status: "processing", progress: p }); }
      }, 180);
    }, 400);
    return () => { cancelled = true; clearTimeout(startDelay); };
  }

  function finish(media, onUpdate) {
    const patch = { status: "completed", progress: 100, completedAt: Date.now() };
    if (media.kind === "image") {
      patch.outputUrl = makeImagePlaceholder(media.prompt, media.aspect || "1:1", "IMAGE");
      patch.thumbnailUrl = patch.outputUrl;
    } else if (media.kind === "audio") {
      patch.estDuration = estimateAudioDuration(media.prompt);
      // outputUrl stays null — audio is rendered live via speak()
    } else { // video / avatar
      patch.posterUrl = media.startImage || makeImagePlaceholder(media.prompt || media.title, media.aspect || "9:16", media.kind === "avatar" ? "AVATAR" : "VIDEO");
      patch.thumbnailUrl = patch.posterUrl;
      patch.outputUrl = patch.posterUrl; // stand-in for the rendered mp4
      patch.estDuration = media.estDuration || (media.duration || 8);
    }
    onUpdate(patch);
  }

  // ---- live voice (stands in for ElevenLabs audio) ----
  function pickSystemVoice(voiceCfg) {
    const vs = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
    if (!vs.length) return null;
    const en = vs.filter((v) => /^en/i.test(v.lang));
    const pool = en.length ? en : vs;
    // crude gender lean by known name hints
    const femaleHints = /(female|samantha|victoria|karen|moira|tessa|fiona|zira|susan|allison|ava|serena)/i;
    const maleHints = /(male|daniel|alex|fred|rishi|aaron|tom|oliver|george|guy)/i;
    let cand = pool.find((v) => (voiceCfg.gender === "female" ? femaleHints : maleHints).test(v.name));
    if (!cand) cand = pool[hashStr(voiceCfg.id) % pool.length];
    return cand;
  }

  function speak(text, voiceId, handlers) {
    handlers = handlers || {};
    if (!window.speechSynthesis) { handlers.onerror && handlers.onerror("Speech not supported in this browser."); return { stop() {} }; }
    const cfg = VOICES.find((v) => v.id === voiceId) || VOICES[0];
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const sv = pickSystemVoice(cfg);
    if (sv) u.voice = sv;
    u.rate = cfg.rate; u.pitch = cfg.pitch;
    u.onstart = () => handlers.onstart && handlers.onstart();
    u.onend = () => handlers.onend && handlers.onend();
    u.onerror = (e) => handlers.onerror && handlers.onerror((e && e.error) || "speech error");
    // voices may load async
    if (!(window.speechSynthesis.getVoices() || []).length) {
      window.speechSynthesis.onvoiceschanged = () => { const v2 = pickSystemVoice(cfg); if (v2) u.voice = v2; };
    }
    window.speechSynthesis.speak(u);
    return { stop() { try { window.speechSynthesis.cancel(); } catch (e) {} } };
  }
  function stopSpeak() { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} }

  window.STUDIO = {
    MODELS, VOICES, TYPES, ASPECT_DIM,
    listModels, modelsByType, getModel, listVoices, getCredits,
    makeImagePlaceholder, estimateAudioDuration, creditsCost, validate,
    runJob, speak, stopSpeak,
  };
})();
