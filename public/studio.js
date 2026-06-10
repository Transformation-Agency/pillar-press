/* ============================================================
   Studio — Hedra + ElevenLabs media engine.
   Generation is now REAL: STUDIO.runJob POSTs to /api/hedra/generate
   and polls /api/hedra/status/:id. The model/voice catalogs and
   credits are fetched live (with the static lists below as a
   fallback when the API is unreachable). Browser TTS preview
   (speak/stopSpeak) and the client-side helpers (placeholders,
   estimates, validation) are kept as-is for the composer UX.
   Plain JS. Exposes window.STUDIO.
   ============================================================ */
(function () {

  // ---- Static fallback catalogs (used until the live fetch lands,
  //      or if it fails). The live catalog replaces MODELS/VOICES
  //      in place so the synchronous getters below stay synchronous. ----
  const MODELS = [
    { id: "hedra-image-1", name: "Hedra Image", type: "image", credits: 6,
      provider: "hedra",
      description: "Text-to-image for post art, hooks, and thumbnails.",
      aspectRatios: ["1:1", "4:5", "16:9", "9:16"], resolutions: ["720p", "1080p"], durations: [],
      requires: { prompt: true } },
    { id: "hedra-character-3-i2v", name: "Character-3 · Image→Video", type: "video", credits: 40,
      provider: "hedra",
      description: "Animate a start image into short motion video. Optional audio as soundtrack.",
      aspectRatios: ["16:9", "9:16", "1:1"], resolutions: ["540p", "720p", "1080p"], durations: [3, 5, 8, 10], maxDuration: 30,
      requires: { prompt: true, startFrame: true, audio: false, endFrame: false } },
    { id: "hedra-character-3-avatar", name: "Character-3 · Avatar", type: "avatar", credits: 60,
      provider: "hedra",
      description: "Talking-head video: a portrait image lip-synced to an audio track.",
      aspectRatios: ["9:16", "1:1", "16:9"], resolutions: ["540p", "720p"], durations: [], maxDuration: 120,
      requires: { startFrame: true, audio: true } },
    { id: "eleven-tts-multilingual-v2", name: "ElevenLabs · Multilingual v2", type: "audio", credits: 1,
      provider: "elevenlabs",
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
  const OPENAI_VOICES = [
    { id: "alloy", name: "Alloy", desc: "Neutral, balanced", gender: "neutral", rate: 1.0, pitch: 1.0 },
    { id: "ash", name: "Ash", desc: "Clear, grounded", gender: "neutral", rate: 1.0, pitch: 1.0 },
    { id: "coral", name: "Coral", desc: "Warm, bright", gender: "female", rate: 1.0, pitch: 1.05 },
    { id: "echo", name: "Echo", desc: "Crisp narration", gender: "male", rate: 1.0, pitch: 0.95 },
    { id: "nova", name: "Nova", desc: "Expressive, lively", gender: "female", rate: 1.0, pitch: 1.08 },
    { id: "onyx", name: "Onyx", desc: "Deep, steady", gender: "male", rate: 0.98, pitch: 0.88 },
    { id: "shimmer", name: "Shimmer", desc: "Light, gentle", gender: "female", rate: 1.0, pitch: 1.12 },
  ];

  const TYPES = [
    { id: "image", label: "Image" },
    { id: "video", label: "Animate" },
    { id: "avatar", label: "Avatar" },
    { id: "audio", label: "Voice" },
  ];

  // Map our composer "kind"/type to the Hedra generate API type.
  const KIND_TO_API_TYPE = { image: "image", video: "video", avatar: "avatar_video", audio: "audio" };

  // ---- live-catalog state ----
  // _catalog holds the live model list once fetched; until then the
  // synchronous getters read from MODELS (the static fallback).
  let _catalog = null;          // array|null — live models
  let _catalogPromise = null;   // de-dupe concurrent fetches
  let _voicesLive = null;       // array|null — live voices
  let _voicesPromise = null;
  let _creditsCache = null;     // last known credits value (number)
  let _creditsPromise = null;

  function currentModels() { return _catalog || MODELS; }

  async function apiGet(path) {
    const r = await fetch("/api" + path, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("GET " + path + " -> " + r.status);
    return r.json();
  }
  async function apiPost(path, body) {
    const r = await fetch("/api" + path, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error("POST " + path + " -> " + r.status);
    return r.json();
  }

  // Normalize a server model record into the shape the composer expects.
  // server type -> composer bucket (the composer groups by image/video/avatar/audio)
  const API_TYPE_TO_KIND = { image: "image", video: "video", avatar_video: "avatar", avatar: "avatar", audio: "audio" };

  function normModel(m) {
    if (!m || !m.id) return null;
    const ar = m.aspect_ratios || m.aspectRatios;
    const res = m.resolutions;
    const dur = m.durations;
    const req = m.requires || {
      startFrame: !!m.requires_start_frame,
      endFrame: !!m.requires_end_frame,
      audio: !!(m.requires_audio || m.requires_audio_input),
    };
    return {
      id: m.id,
      name: m.name || m.label || m.id,
      provider: m.provider || m.providerId || "hedra",
      type: API_TYPE_TO_KIND[m.type] || m.type || "image",
      credits: typeof m.credits === "number" ? m.credits : (m.cost || 0),
      description: m.description || "",
      aspectRatios: Array.isArray(ar) ? ar : [],
      // "fixed" / empty mean the model has no chooseable resolution — keep it
      // out of the picker so we never send an unsupported value.
      resolutions: Array.isArray(res) ? res.filter((r) => r && r !== "fixed") : [],
      durations: Array.isArray(dur) ? dur : [],
      maxDuration: m.max_duration || m.maxDuration,
      requires: req,
    };
  }

  // listModels(types) keeps its sync signature (returns from cache), but
  // also triggers a one-time live hydration of the catalog. Callers that
  // want the live list should re-read after the returned promise (exposed
  // via STUDIO.refreshModels) resolves and a re-render occurs.
  function listModels(types) {
    if (!_catalog && !_catalogPromise) refreshModels();
    const list = currentModels();
    return types ? list.filter((m) => types.includes(m.type)) : list.slice();
  }

  // Fetch the live catalog (all types) and cache it. Returns a promise
  // that resolves to the model array (live or fallback on failure).
  function refreshModels() {
    if (_catalogPromise) return _catalogPromise;
    const types = ["image", "video", "avatar_video", "audio"];
    _catalogPromise = Promise.all([
      apiGet("/media/providers").catch(() => null),
      ...types.map((t) => apiGet("/hedra/models?type=" + encodeURIComponent(t)).catch(() => null)),
    ]).then((results) => {
      const merged = [];
      const seen = {};
      const providerStatus = results[0];
      const providerModels = providerStatus && Array.isArray(providerStatus.providers)
        ? providerStatus.providers.flatMap((p) => Array.isArray(p.models) && p.configured ? p.models : [])
        : [];
      providerModels.forEach((raw) => {
        const m = normModel(raw);
        if (m && !seen[m.provider + ":" + m.id]) { seen[m.provider + ":" + m.id] = true; merged.push(m); }
      });
      results.slice(1).forEach((res) => {
        const arr = res && (Array.isArray(res) ? res : (res.models || res.items));
        if (!Array.isArray(arr)) return;
        arr.forEach((raw) => {
          const m = normModel(raw);
          if (m && !seen[m.provider + ":" + m.id]) { seen[m.provider + ":" + m.id] = true; merged.push(m); }
        });
      });
      // Hedra serves only image/video models; audio (TTS) is ElevenLabs, so it
      // never appears in the live list. Keep a synthetic audio model so the
      // Voice composer always has something to select.
      if (merged.length && !merged.some((m) => m.type === "audio")) {
        const fallbackAudio = MODELS.find((m) => m.type === "audio");
        if (fallbackAudio) merged.push(fallbackAudio);
      }
      if (merged.length) _catalog = merged;
      return currentModels();
    }).catch(() => currentModels());
    return _catalogPromise;
  }

  function modelsByType(type) { return currentModels().filter((m) => m.type === type); }
  function getModel(id) { return currentModels().find((m) => m.id === id) || null; }
  // Best model for combining an image + audio into a video: a video model that
  // takes a start frame AND an audio track (duration auto-syncs to the audio).
  // Prefer Hedra Character 3 / Hedra Avatar; fall back to the known id.
  function combineModelId() {
    const vids = currentModels().filter((m) => m.type === "video" && m.requires && m.requires.audio);
    const pick = vids.find((m) => /character\s*3/i.test(m.name)) || vids.find((m) => /hedra/i.test(m.name)) || vids[0];
    return pick ? pick.id : "d1dd37a3-e39a-4854-a298-6510289f9cf2";
  }

  // listVoices() keeps its sync signature; live voices replace the cache.
  function listVoices(provider) {
    if (provider === "openai") return OPENAI_VOICES.slice();
    if (!_voicesLive && !_voicesPromise) refreshVoices();
    return (_voicesLive || VOICES).slice();
  }
  function refreshVoices() {
    if (_voicesPromise) return _voicesPromise;
    _voicesPromise = apiGet("/eleven/voices").then((res) => {
      const arr = res && (Array.isArray(res) ? res : res.voices);
      if (Array.isArray(arr) && arr.length) {
        _voicesLive = arr.map((v) => ({
          id: v.id || v.voice_id || v.voiceId,
          name: v.name || v.id,
          desc: v.desc || v.description || "",
          gender: v.gender || (v.labels && v.labels.gender) || "female",
          rate: typeof v.rate === "number" ? v.rate : 1.0,
          pitch: typeof v.pitch === "number" ? v.pitch : 1.0,
        })).filter((v) => v.id);
      }
      return (_voicesLive || VOICES).slice();
    }).catch(() => VOICES.slice());
    return _voicesPromise;
  }

  // getCredits() stays sync (used in render). Returns the cached value,
  // falling back to a sensible default until refreshCredits() lands.
  function getCredits() {
    if (_creditsCache == null && !_creditsPromise) refreshCredits();
    if (_creditsCache != null) return _creditsCache;
    return 0;
  }
  function refreshCredits() {
    if (_creditsPromise) return _creditsPromise;
    _creditsPromise = apiGet("/hedra/credits").then((res) => {
      const n = res && (typeof res === "number" ? res : (res.credits != null ? res.credits : res.balance != null ? res.balance : res.remaining));
      if (typeof n === "number") _creditsCache = n;
      return _creditsCache;
    }).catch(() => _creditsCache).then((v) => { _creditsPromise = null; return v; });
    return _creditsPromise;
  }

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
    // Voiceover scripts are chunked + stitched server-side, so they can be long;
    // image/video prompts stay capped at 2000.
    var maxLen = model.type === "audio" ? 100000 : 2000;
    if ((params.prompt || "").length > maxLen) return "Prompt is too long (max " + maxLen + " characters).";
    if (r.startFrame && !params.startImage) return "This model needs a start image. Upload or pick one.";
    if (r.endFrame && !params.endImage) return "This model needs an end image.";
    if (r.audio && !params.audioRef) return "This avatar model needs an audio track. Generate or pick a voiceover first.";
    if (r.voice && !params.voiceId) return "Choose a voice.";
    if (model.aspectRatios && model.aspectRatios.length && params.aspect && !model.aspectRatios.includes(params.aspect)) return "That aspect ratio isn't supported by this model.";
    if (model.maxDuration && params.duration && params.duration > model.maxDuration) return `Max duration for this model is ${model.maxDuration}s.`;
    return null;
  }

  // ---- real async job runner ----
  // POSTs the media's params to /api/hedra/generate, then polls
  // /api/hedra/status/:id every ~3s, forwarding {status,progress,
  // outputUrl,downloadUrl,thumbnailUrl} (plus jobId/posterUrl) to
  // onUpdate until a terminal status. Returns a cancel function.
  const TERMINAL = { completed: 1, failed: 1, canceled: 1, cancelled: 1 };

  // ---- per-campaign learned image style ----
  const STYLE_KNOBS = {
    palette: ["warm", "cool", "muted", "vivid", "mono"],
    mood: ["bright", "neutral", "moody"],
    finish: ["photographic", "illustrated", "painterly", "graphic"],
    detail: ["minimal", "balanced", "detailed"],
  };
  // Preview/regenerate the art-directed image prompt (no image generated).
  function craftPrompt(body) { return apiPost("/hedra/prompt", body || {}); }
  function craftVoiceScript(body) { return apiPost("/hedra/voice-script", body || {}); }
  function getStyle(campaignId) { return apiGet("/campaigns/" + encodeURIComponent(campaignId) + "/style"); }
  function sendStyleFeedback(campaignId, body) { return apiPost("/campaigns/" + encodeURIComponent(campaignId) + "/style/feedback", body); }

  function buildGenerateBody(media) {
    const type = KIND_TO_API_TYPE[media.kind] || "image";
    const body = { type, modelId: media.modelId };
    if (media.provider) body.provider = media.provider;
    if (media.campaignId) body.campaignId = media.campaignId;
    if (media.enhance !== undefined) body.enhance = media.enhance;
    if (media.directed) body.directed = true;
    if (media.aspect) body.aspectRatio = media.aspect;
    if (media.resolution) body.resolution = media.resolution;
    if (media.duration) body.duration = media.duration;
    if (media.startImage) body.startAssetId = media.startImage;
    if (media.audioMediaId) body.audioMediaId = media.audioMediaId; // combine: use an existing audio item as the track
    if (media.pieceId) body.pieceId = media.pieceId;
    // prompt vs script: voiceover/tts carries the spoken text as `script`;
    // everything else carries `prompt`.
    if (media.kind === "audio") {
      body.script = media.audioScript || media.prompt || "";
      if (media.voiceId) body.voiceId = media.voiceId;
    } else {
      if (media.prompt) body.prompt = media.prompt;
      // a video/avatar with a synced voiceover also carries script + voice
      if (media.audioScript) body.script = media.audioScript;
      if (media.voiceId) body.voiceId = media.voiceId;
    }
    return body;
  }

  function normStatus(job) {
    const out = {};
    const st = (job.status || "").toLowerCase();
    out.status = st === "cancelled" ? "canceled" : st || "processing";
    if (typeof job.progress === "number") out.progress = job.progress;
    if (job.outputUrl) out.outputUrl = job.outputUrl;
    if (job.downloadUrl) out.downloadUrl = job.downloadUrl;
    if (job.thumbnailUrl) { out.thumbnailUrl = job.thumbnailUrl; out.posterUrl = job.thumbnailUrl; }
    if (job.meta && job.meta.enhancedPrompt) out.enhancedPrompt = job.meta.enhancedPrompt;
    if (job.hedraAssetId) out.hedraAssetId = job.hedraAssetId; // so a fresh image can be combined by asset id (no re-fetch)
    if (job.error) out.error = job.error;
    return out;
  }

  function runJob(media, onUpdate, opts) {
    let cancelled = false;
    let timer = null;
    // One-shot auto-retry when a job FAILS MID-RENDER (status -> failed after a
    // successful submit). The server already retries transient submit errors, so
    // submit-level failures are surfaced as-is and not re-run here.
    const maxRetries = (opts && typeof opts.retries === "number") ? opts.retries : 1;
    let retried = 0;
    onUpdate({ status: "queued", progress: 0 });

    const onMidRenderFail = (errMsg) => {
      if (cancelled) return;
      if (retried < maxRetries) {
        retried += 1;
        onUpdate({ status: "queued", progress: 0, error: null }); // clear + re-run
        timer = setTimeout(submit, 1500);
      } else {
        onUpdate({ status: "failed", error: errMsg || "Generation failed." });
      }
    };

    const submit = () => {
      if (cancelled) return;
      apiPost("/hedra/generate", buildGenerateBody(media)).then((res) => {
        if (cancelled) return;
        const job = (res && res.job) || res || {};
        const jobId = job.id;
        const st = (job.status || "").toLowerCase();
        if (st === "failed") { onMidRenderFail(job.errorMessage || job.error || "Generation failed."); return; }
        const first = normStatus(job);
        first.jobId = jobId;
        if (first.progress == null) first.progress = 2;
        onUpdate(first);
        if (TERMINAL[st]) return; // completed/canceled immediately
        if (!jobId) { onUpdate({ status: "failed", error: "No job id returned." }); return; }

        const poll = () => {
          if (cancelled) return;
          apiGet("/hedra/status/" + encodeURIComponent(jobId)).then((sres) => {
            if (cancelled) return;
            const sjob = (sres && sres.job) || sres || {};
            const sst = (sjob.status || "").toLowerCase();
            if (sst === "failed") { onMidRenderFail(sjob.errorMessage || sjob.error || "Generation failed."); return; }
            onUpdate(normStatus(sjob));
            if (TERMINAL[sst]) return; // completed / canceled — stop polling
            timer = setTimeout(poll, 3000);
          }).catch(() => {
            if (cancelled) return;
            timer = setTimeout(poll, 3000); // transient status-read error — keep polling
          });
        };
        timer = setTimeout(poll, 3000);
      }).catch((e) => {
        if (cancelled) return;
        // Submit failed even after the server's transient retries — surface it.
        onUpdate({ status: "failed", error: (e && e.message) || "Generation request failed." });
      });
    };

    submit();
    return function cancel() { cancelled = true; if (timer) clearTimeout(timer); };
  }

  // ---- live voice preview (browser TTS — kept for the composer) ----
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
    const voicesNow = (_voicesLive || VOICES);
    const cfg = voicesNow.find((v) => v.id === voiceId) || VOICES.find((v) => v.id === voiceId) || VOICES[0];
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const sv = pickSystemVoice(cfg);
    if (sv) u.voice = sv;
    u.rate = cfg.rate || 1.0; u.pitch = cfg.pitch || 1.0;
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
    listModels, modelsByType, getModel, combineModelId, listVoices, getCredits,
    refreshModels, refreshVoices, refreshCredits,
    makeImagePlaceholder, estimateAudioDuration, creditsCost, validate,
    runJob, speak, stopSpeak,
    STYLE_KNOBS, getStyle, sendStyleFeedback, craftPrompt, craftVoiceScript,
  };
})();
