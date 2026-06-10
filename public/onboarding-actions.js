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

  const EVENTS = {
    PROVIDER_SETUP_OPENED: "kingspress:onboarding-provider-setup-opened",
    PROVIDER_SETUP_SAVED: "kingspress:onboarding-provider-setup-saved",
    PROVIDER_SETUP_CLOSED: "kingspress:onboarding-provider-setup-closed",
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

  function providerSafeDetail(settings) {
    const profile = settings && settings.profile ? settings.profile : settings;
    if (!profile || typeof profile !== "object") return {};
    return {
      id: profile.id || settings.defaultProfileId || null,
      label: profile.label || null,
      provider: profile.provider || settings.provider || null,
      model: profile.model || settings.model || null,
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
      const desktop = window.KINGS_DESKTOP;
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
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone access is not available here.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const desktop = window.KINGS_DESKTOP;
      if (desktop && desktop.isDesktop && desktop.isDesktop() && desktop.startVoiceSession) {
        await desktop.startVoiceSession();
      }
      return succeeded(intent, { voiceConnected: true });
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
      const activeCampaign = options && options.activeCampaign;
      const clean = String(name || "").trim();
      if (activeCampaign && (!clean || clean === activeCampaign.name)) {
        return succeeded(intent, { campaignId: activeCampaign.id, reused: true });
      }
      const Store = window.Store;
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

  async function completeOnboarding(options) {
    const intent = INTENTS.COMPLETE_ONBOARDING || "complete_onboarding";
    try {
      const Store = window.Store;
      if (!Store || typeof Store.setPref !== "function") throw new Error("Local store is not ready.");
      Store.setPref(flags.onboardingCompletePref, true);
      let firstValueEvent = null;
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
      }
      return succeeded(intent, {
        onboardingComplete: true,
        firstValueComplete: !!(firstValueEvent && firstValueEvent.complete),
        firstValueEvent,
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
    const desktop = window.KINGS_DESKTOP;
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

  function notifyProviderSetupSaved(settings) {
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
    completeOnboarding,
    skipOnboarding,
    onProviderSetupSaved,
    onSttFinal,
    notifyProviderSetupSaved,
    notifyProviderSetupClosed,
  };
})();
