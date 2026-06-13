/* Onboarding action registry.
   Keeps side effects behind named, testable actions so the conversation shell
   can show pending/succeeded/failed states without owning every integration. */
(function () {
  const runtime = window.KP_CONVERSATIONAL_ONBOARDING || {};
  const INTENTS = runtime.ACTION_INTENTS || {};
  const STATUSES = runtime.ACTION_STATUSES || {
    PENDING: "pending",
    SUCCEEDED: "succeeded",
    FAILED: "failed",
    SKIPPED: "skipped",
  };
  const flags = runtime.flags || { onboardingCompletePref: "setupHelperCompleteV1" };
  const METRIC_EVENTS = runtime.METRIC_EVENTS || {
    STARTED: "onboarding_started",
    STEP_VIEWED: "step_viewed",
    ANSWER_CAPTURED: "answer_captured",
    ANSWER_REPAIRED: "answer_repaired",
    FALLBACK_USED: "fallback_used",
    SKIPPED: "onboarding_skipped",
    FIRST_VALUE_COMPLETED: "first_value_completed",
    COMPLETED: "onboarding_completed",
    SENTIMENT_SUBMITTED: "sentiment_submitted",
    SENTIMENT_DISMISSED: "sentiment_dismissed",
    LIVE_ASSISTANT_HANDOFF: "live_assistant_handoff",
  };

  const EVENTS = {
    PROVIDER_SETUP_OPENED: "pillarpress:onboarding-provider-setup-opened",
    PROVIDER_SETUP_SAVED: "pillarpress:onboarding-provider-setup-saved",
    PROVIDER_SETUP_CLOSED: "pillarpress:onboarding-provider-setup-closed",
  };

  function cleanError(error, fallback) {
    const message = (error && error.message) || (typeof error === "string" ? error : fallback);
    return String(message || "Action failed.")
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
      .replace(/api[_-]?key[=:]\s*[^&\s]+/gi, "api_key=[redacted]")
      .replace(/password[=:]\s*[^&\s]+/gi, "password=[redacted]");
  }

  function normalize(intent, status, payload) {
    if (runtime.normalizeActionResult) {
      return runtime.normalizeActionResult(intent, Object.assign({ status }, payload || {}));
    }
    return Object.assign({ intent, status, updatedAt: Date.now() }, payload || {});
  }

  function succeeded(intent, data) {
    return normalize(intent, STATUSES.SUCCEEDED, { data: data || null, error: null });
  }

  function failed(intent, error, fallback) {
    return normalize(intent, STATUSES.FAILED, { data: null, error: cleanError(error, fallback) });
  }

  function skipped(intent, data) {
    return normalize(intent, STATUSES.SKIPPED, { data: data || null, error: null });
  }

  function markDesktopSetupComplete() {
    try {
      const key = flags.computeSetupLocalStorageKey || "pillarpress.desktopSetupComplete";
      if (window.localStorage && key) window.localStorage.setItem(key, "true");
    } catch (_error) {}
  }

  function setStorePrefs(Store, patch) {
    if (!Store || !patch || typeof patch !== "object") return;
    if (typeof Store.setPrefs === "function") {
      Store.setPrefs(patch);
      return;
    }
    if (typeof Store.setPref === "function") {
      Object.keys(patch).forEach((key) => Store.setPref(key, patch[key]));
    }
  }

  function handoffThreadId(sessionId) {
    const safe = String(sessionId || "setup")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "setup";
    return "setup_handoff_" + safe;
  }

  function transcriptTurnToMessage(turn, index) {
    const role = turn && turn.role === "user" ? "user" : "assistant";
    const content = String((turn && (turn.text || turn.content)) || "").trim();
    if (!content) return null;
    return {
      id: "setup_msg_" + index,
      role,
      content,
    };
  }

  function buildHandoffThread(handoff, transcript) {
    const threadId = handoffThreadId(handoff && handoff.sessionId);
    const turns = transcript && Array.isArray(transcript.turns) ? transcript.turns : [];
    const messages = turns
      .map(transcriptTurnToMessage)
      .filter(Boolean);
    const campaignName = (handoff && handoff.campaignName) || "your first focus";
    const providerReady = !!(handoff && handoff.providerReady);
    messages.push({
      id: "setup_msg_ready",
      role: "assistant",
      content: providerReady
        ? "Setup is ready for " + campaignName + ". I kept our setup transcript here, so you can continue by telling me what you want to draft, gather, or refine first."
        : "Setup is saved for " + campaignName + ". Model setup is still deferred, but I kept our setup transcript here so the desk can continue once a provider is ready.",
    });
    return {
      id: threadId,
      title: "Setup handoff",
      titleSet: true,
      source: "pillar_press_setup",
      sessionId: handoff && handoff.sessionId,
      campaignId: handoff && handoff.campaignId,
      messages,
      memory: {
        note: "Onboarding captured the first focus, provider/voice decision, and essential writing preferences. Continue from this setup context.",
        covered: turns.length,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function seedDeskHandoffThread(handoff, transcript) {
    const intent = INTENTS.COMPLETE_ONBOARDING || "complete_onboarding";
    try {
      const Store = window.Store;
      if (!Store || typeof Store.getDesk !== "function" || typeof Store.setDesk !== "function") {
        return null;
      }
      const thread = buildHandoffThread(handoff, transcript);
      const desk = Store.getDesk() || { threads: [], activeId: null };
      const threads = Array.isArray(desk.threads) ? desk.threads.slice() : [];
      const existingIndex = threads.findIndex((item) => item && item.id === thread.id);
      if (existingIndex >= 0) threads[existingIndex] = Object.assign({}, threads[existingIndex], thread);
      else threads.unshift(thread);
      Store.setDesk(Object.assign({}, desk, {
        threads,
        activeId: thread.id,
      }));
      return {
        deskThreadId: thread.id,
        transcriptTurnCount: transcript && Array.isArray(transcript.turns) ? transcript.turns.length : 0,
      };
    } catch (error) {
      console.warn("[Onboarding] " + cleanError(error, "Could not seed setup handoff thread."));
      return null;
    }
  }

  function providerSafeDetail(settings) {
    const profile = settings && settings.profile ? settings.profile : settings;
    if (!profile || typeof profile !== "object") return {};
    const rawBaseUrl = profile.baseUrl || settings.baseUrl || null;
    let safeBaseUrl = rawBaseUrl;
    if (rawBaseUrl) {
      try {
        const URLCtor = typeof URL !== "undefined" ? URL : window && window.URL;
        const parsed = new URLCtor(rawBaseUrl);
        parsed.username = "";
        parsed.password = "";
        safeBaseUrl = parsed.toString().replace(/\/$/, rawBaseUrl.endsWith("/") ? "/" : "");
      } catch (_error) {
        safeBaseUrl = String(rawBaseUrl).replace(/^(https?:\/\/)[^/@]+@/i, "$1");
      }
    }
    return {
      id: profile.id || settings.defaultProfileId || null,
      label: profile.label || null,
      provider: profile.provider || settings.provider || null,
      model: profile.model || settings.model || null,
      baseUrl: safeBaseUrl,
      hasApiKey: !!(profile.hasApiKey || settings.hasApiKey || profile.apiKey || settings.apiKey),
    };
  }

  function emit(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (_err) {
      window.dispatchEvent(new Event(name));
    }
  }

  async function providerStatus() {
    const intent = INTENTS.OPEN_PROVIDER_SETUP || "open_provider_setup";
    try {
      const response = await fetch("/api/llm/status", { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data && data.error) || "Could not read model status.");
      return succeeded(intent, data);
    } catch (error) {
      return failed(intent, error, "Could not read model status.");
    }
  }

  async function openProviderSetup(options) {
    const intent = INTENTS.OPEN_PROVIDER_SETUP || "open_provider_setup";
    try {
      if (!options || typeof options.onOpenProviderSetup !== "function") {
        throw new Error("Model setup is available in the desktop app.");
      }
      const desktop = window.PILLAR_DESKTOP;
      if (!desktop || !desktop.isDesktop || !desktop.isDesktop()) {
        throw new Error("Model setup is available in the desktop app.");
      }
      emit(EVENTS.PROVIDER_SETUP_OPENED);
      options.onOpenProviderSetup();
      return normalize(intent, STATUSES.PENDING, { data: { opened: true }, error: null });
    } catch (error) {
      return failed(intent, error, "Could not open model setup.");
    }
  }

  async function requestVoice() {
    const intent = INTENTS.REQUEST_VOICE || "request_voice";
    try {
      const desktop = window.PILLAR_DESKTOP;
      if (desktop && desktop.isDesktop && desktop.isDesktop() && desktop.startVoiceSession) {
        return succeeded(intent, { voiceConnected: true, transcription: "local-whisper" });
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone access is not available here.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return succeeded(intent, { voiceConnected: true, transcription: "browser" });
    } catch (error) {
      return failed(intent, error, "Audio setup failed. You can continue by typing.");
    }
  }

  async function exploreIntegrations() {
    return skipped(INTENTS.EXPLORE_INTEGRATIONS || "explore_integrations", {
      integrationsTouched: true,
      reason: "connect_later",
    });
  }

  async function saveFocus(name, options) {
    const intent = INTENTS.SAVE_FOCUS || "save_focus";
    try {
      const Store = window.Store;
      const activeCampaign = options && options.activeCampaign;
      const campaigns = (options && options.campaigns) || [];
      const clean = String(name || "").trim();
      if (activeCampaign && (!clean || clean === activeCampaign.name)) {
        return succeeded(intent, { campaignId: activeCampaign.id, reused: true });
      }
      const existing = clean && campaigns.find((campaign) => campaign && campaign.name === clean);
      if (existing) {
        if (Store && typeof Store.setActiveCampaign === "function") Store.setActiveCampaign(existing.id);
        return succeeded(intent, { campaignId: existing.id, reused: true });
      }
      if (!Store || typeof Store.addCampaign !== "function") throw new Error("Local store is not ready.");
      const tempId = Store.addCampaign(clean || "Untitled focus");
      const saved = Store.whenCampaignSaved ? await Store.whenCampaignSaved(tempId) : null;
      return succeeded(intent, {
        campaignId: (saved && saved.id) || tempId,
        tempId,
        reused: false,
      });
    } catch (error) {
      return failed(intent, error, "Could not save the first focus.");
    }
  }

  async function savePreferences(patch) {
    const intent = INTENTS.SAVE_PREFERENCES || "save_preferences";
    try {
      const Store = window.Store;
      if (!Store || typeof Store.updateReferences !== "function") throw new Error("Local store is not ready.");
      await Store.updateReferences(patch);
      return succeeded(intent, { saved: true });
    } catch (error) {
      return failed(intent, error, "Could not save preferences.");
    }
  }

  async function extractSetupProfile(payload) {
    const intent = INTENTS.EXTRACT_SETUP_PROFILE || "extract_setup_profile";
    try {
      const response = await fetch("/api/onboarding/extract-setup-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });
      const body = await response.json().catch(function () { return null; });
      if (!response.ok) {
        throw new Error((body && (body.error || body.message)) || "Could not interpret setup answer.");
      }
      return succeeded(intent, {
        profileDraft: body && body.profileDraft,
        requiresUserApproval: !!(body && body.requiresUserApproval),
      });
    } catch (error) {
      return failed(intent, error, "Could not interpret setup answer.");
    }
  }

  function persistMetricsEvent(eventInput, extraPrefs) {
    const intent = INTENTS.RECORD_METRIC || "record_metric";
    try {
      const Store = window.Store;
      if (!Store || typeof Store.setPref !== "function" || typeof Store.getPref !== "function") {
        throw new Error("Local store is not ready.");
      }
      const event = runtime.buildMetricsEvent
        ? runtime.buildMetricsEvent(eventInput && eventInput.type, eventInput)
        : Object.assign({ version: 1, at: new Date().toISOString() }, eventInput || {});
      const key = flags.metricsEventsPref || "onboardingMetricsEventsV1";
      const current = Store.getPref(key, []);
      const events = runtime.appendMetricsEvent
        ? runtime.appendMetricsEvent(current, event, runtime.MAX_METRICS_EVENTS)
        : (Array.isArray(current) ? current.concat(event).slice(-120) : [event]);
      const summary = runtime.deriveMetricsSummary
        ? runtime.deriveMetricsSummary(events)
        : { version: 1, updatedAt: new Date().toISOString(), latestEventType: event.type || null };
      setStorePrefs(Store, Object.assign({}, extraPrefs || {}, {
        [key]: events,
        [flags.metricsSummaryPref || "onboardingMetricsSummaryV1"]: summary,
      }));
      return succeeded(intent, { event, summary });
    } catch (error) {
      return failed(intent, error, "Could not record onboarding metric.");
    }
  }

  function recordMetric(type, payload) {
    return persistMetricsEvent(Object.assign({}, payload || {}, { type }));
  }

  async function submitSentiment(rating, payload) {
    const intent = INTENTS.SUBMIT_SENTIMENT || "submit_sentiment";
    try {
      const n = Math.max(1, Math.min(5, Math.round(Number(rating))));
      if (!Number.isFinite(n)) throw new Error("Choose a rating from 1 to 5.");
      const Store = window.Store;
      if (!Store || typeof Store.setPref !== "function") throw new Error("Local store is not ready.");
      const sentiment = {
        version: 1,
        rating: n,
        submittedAt: new Date().toISOString(),
        source: "post_onboarding_prompt",
      };
      const metric = persistMetricsEvent(Object.assign({}, payload || {}, {
        type: METRIC_EVENTS.SENTIMENT_SUBMITTED,
        rating: n,
      }), { [flags.sentimentPref || "onboardingSentimentV1"]: sentiment });
      if (metric.status === STATUSES.FAILED) throw new Error(metric.error);
      return succeeded(intent, Object.assign({}, sentiment, { summary: metric.data && metric.data.summary }));
    } catch (error) {
      return failed(intent, error, "Could not save onboarding rating.");
    }
  }

  function dismissSentiment(payload) {
    const dismissed = {
      version: 1,
      dismissedAt: new Date().toISOString(),
      source: "post_onboarding_prompt",
    };
    const metric = persistMetricsEvent(Object.assign({}, payload || {}, {
      type: METRIC_EVENTS.SENTIMENT_DISMISSED,
    }), { [flags.sentimentPref || "onboardingSentimentV1"]: dismissed });
    return metric;
  }

  async function completeOnboarding(options) {
    const intent = INTENTS.COMPLETE_ONBOARDING || "complete_onboarding";
    try {
      const Store = window.Store;
      if (!Store || typeof Store.setPref !== "function") throw new Error("Local store is not ready.");
      Store.setPref(flags.onboardingCompletePref, true);
      markDesktopSetupComplete();
      let firstValueEvent = null;
      const transcript = options && options.transcript && typeof options.transcript === "object"
        ? Object.assign({}, options.transcript, {
          persistedAt: new Date().toISOString(),
          source: "pillar_press_setup",
        })
        : null;
      if (transcript) {
        Store.setPref(flags.transcriptPref || "onboardingSetupTranscriptV1", transcript);
      }
      if (options && options.firstValueComplete) {
        firstValueEvent = runtime.buildFirstValueEvent
          ? runtime.buildFirstValueEvent(options.firstValue || options)
          : {
            id: "first_usable_setup",
            version: 1,
            completedAt: new Date().toISOString(),
            complete: true,
        };
        Store.setPref(flags.firstValuePref || "onboardingFirstValueEventV1", firstValueEvent);
        persistMetricsEvent(Object.assign({}, firstValueEvent, {
          type: METRIC_EVENTS.FIRST_VALUE_COMPLETED,
          sessionId: options.sessionId,
          durationMs: firstValueEvent.setupDurationMs,
          firstValueComplete: firstValueEvent.complete,
        }));
      }
      const handoff = {
        version: 1,
        createdAt: new Date().toISOString(),
        source: "pillar_press_setup",
        sessionId: options && options.sessionId,
        activation: firstValueEvent,
        routeTarget: (firstValueEvent && firstValueEvent.routeTarget) || (options && options.routeTarget) || "desk",
        campaignId: (firstValueEvent && firstValueEvent.campaignId) || (options && options.campaignId) || null,
        campaignName: (firstValueEvent && firstValueEvent.campaignName) || (options && options.campaignName) || "",
        providerReady: !!(firstValueEvent && firstValueEvent.providerReady),
        transcriptPref: flags.transcriptPref || "onboardingSetupTranscriptV1",
        transcriptTurnCount: transcript && Array.isArray(transcript.turns) ? transcript.turns.length : 0,
        nextAssistantMode: firstValueEvent && firstValueEvent.providerReady
          ? "live_assistant_ready"
          : "scripted_assistant_until_provider_ready",
      };
      const handoffThread = seedDeskHandoffThread(handoff, transcript);
      if (handoffThread && handoffThread.deskThreadId) {
        handoff.deskThreadId = handoffThread.deskThreadId;
      }
      Store.setPref(flags.handoffPref || "onboardingAssistantHandoffV1", handoff);
      if (handoffThread && handoffThread.deskThreadId) {
        persistMetricsEvent({
          type: METRIC_EVENTS.LIVE_ASSISTANT_HANDOFF,
          sessionId: options && options.sessionId,
          firstValueComplete: !!(firstValueEvent && firstValueEvent.complete),
          routeTarget: handoff.routeTarget,
          campaignId: handoff.campaignId,
          deskThreadId: handoffThread.deskThreadId,
          transcriptTurnCount: handoffThread.transcriptTurnCount,
        });
      }
      persistMetricsEvent({
        type: METRIC_EVENTS.COMPLETED,
        sessionId: options && options.sessionId,
        durationMs: firstValueEvent && firstValueEvent.setupDurationMs,
        firstValueComplete: !!(firstValueEvent && firstValueEvent.complete),
        routeTarget: firstValueEvent && firstValueEvent.routeTarget,
        campaignId: firstValueEvent && firstValueEvent.campaignId,
      });
      return succeeded(intent, {
        onboardingComplete: true,
        firstValueComplete: !!(firstValueEvent && firstValueEvent.complete),
        firstValueEvent,
        handoff,
        transcript,
        sessionId: options && options.sessionId,
      });
    } catch (error) {
      return failed(intent, error, "Could not finish setup.");
    }
  }

  async function skipOnboarding() {
    const intent = INTENTS.SKIP_ONBOARDING || "skip_onboarding";
    try {
      if (window.Store && typeof window.Store.setPref === "function") {
        window.Store.setPref(flags.onboardingCompletePref, true);
      }
      markDesktopSetupComplete();
      persistMetricsEvent({
        type: METRIC_EVENTS.SKIPPED,
        skippedReason: "user_skipped_setup",
        firstValueComplete: false,
      });
      return skipped(intent, { onboardingComplete: true });
    } catch (error) {
      return failed(intent, error, "Could not skip setup.");
    }
  }

  function onProviderSetupSaved(handler) {
    const listener = (event) => handler(event.detail || {});
    window.addEventListener(EVENTS.PROVIDER_SETUP_SAVED, listener);
    return () => window.removeEventListener(EVENTS.PROVIDER_SETUP_SAVED, listener);
  }

  function onSttFinal(handler) {
    const desktop = window.PILLAR_DESKTOP;
    if (!desktop || !desktop.isDesktop || !desktop.isDesktop() || !desktop.onSttFinal) {
      return Promise.resolve(function () {});
    }
    return desktop.onSttFinal((event) => {
      const payload = event && event.payload ? event.payload : event;
      const transcript = payload && payload.transcript ? String(payload.transcript) : "";
      if (transcript.trim()) handler({ transcript: transcript.trim(), source: "desktop" });
    }).catch(function () {
      return function () {};
    });
  }

  function onVoiceStatus(handler) {
    const desktop = window.PILLAR_DESKTOP;
    if (!desktop || !desktop.isDesktop || !desktop.isDesktop() || !desktop.onVoiceStatus) {
      return Promise.resolve(function () {});
    }
    return desktop.onVoiceStatus((event) => {
      const payload = event && event.payload ? event.payload : event;
      handler(payload || {});
    }).catch(function () {
      return function () {};
    });
  }

  function notifyProviderSetupSaved(settings) {
    markDesktopSetupComplete();
    emit(EVENTS.PROVIDER_SETUP_SAVED, providerSafeDetail(settings));
  }

  function notifyProviderSetupClosed(detail) {
    emit(EVENTS.PROVIDER_SETUP_CLOSED, detail || {});
  }

  window.KP_ONBOARDING_ACTIONS = {
    EVENTS,
    cleanError,
    providerSafeDetail,
    providerStatus,
    openProviderSetup,
    requestVoice,
    exploreIntegrations,
    saveFocus,
    savePreferences,
    extractSetupProfile,
    persistMetricsEvent,
    recordMetric,
    buildHandoffThread,
    seedDeskHandoffThread,
    submitSentiment,
    dismissSentiment,
    completeOnboarding,
    skipOnboarding,
    onProviderSetupSaved,
    onSttFinal,
    onVoiceStatus,
    notifyProviderSetupSaved,
    notifyProviderSetupClosed,
  };
})();
