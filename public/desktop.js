/* Pillar Press desktop bridge.
   In a browser this is inert. In Tauri it exposes local-first setup commands. */
(function () {
  const core = window.__TAURI__ && window.__TAURI__.core;
  const event = window.__TAURI__ && window.__TAURI__.event;

  function isDesktop() { return !!(core && typeof core.invoke === "function"); }

  function clean(value) {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return value.map(clean).filter((item) => item !== undefined);
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        const cleaned = clean(child);
        if (cleaned !== undefined) out[key] = cleaned;
      }
      return out;
    }
    return value;
  }

  async function invoke(command, args) {
    if (!isDesktop()) throw new Error("Desktop runtime is not available.");
    return core.invoke(command, clean(args || {}));
  }

  async function listen(name, handler) {
    if (!isDesktop() || !event || typeof event.listen !== "function") return function () {};
    return event.listen(name, handler);
  }

  window.PILLAR_DESKTOP = {
    isDesktop,
    ollamaStatus: () => invoke("ollama_status"),
    startOllama: () => invoke("start_ollama_service"),
    openOllamaDownload: () => invoke("open_ollama_download"),
    openExternalUrl: (url) => invoke("open_external_url", { url }),
    listOllamaModels: () => invoke("list_ollama_models"),
    pullOllamaModel: (model) => invoke("pull_ollama_model", { model }),
    saveModelChoice: (model) => invoke("save_model_choice", { model }),
    saveLLMSettings: (settings) => invoke("save_llm_settings", { settings }),
    saveMediaProviderKey: (provider, apiKey, options) => invoke("save_media_provider_key", { args: { provider, apiKey, baseUrl: options && options.baseUrl } }),
    saveIntegrationKey: (integration, apiKey, options) => invoke("save_integration_key", { args: { integration, apiKey, baseUrl: options && options.baseUrl } }),
    getModelChoice: () => invoke("get_model_choice"),
    initLocalDatabase: () => invoke("init_local_database"),
    createLocalBackup: () => invoke("create_local_backup"),
    saveExportFile: (filename, base64) => invoke("save_export_file", { args: { filename, base64 } }),
    saveAudioFile: (filename, base64) => invoke("save_audio_file", { args: { filename, base64 } }),
    runtimeStatus: () => invoke("desktop_runtime_status"),
    startVoiceSession: () => invoke("start_voice_session"),
    speakText: (text, options) => invoke("speak_text", { args: { text, interrupt: !!(options && options.interrupt) } }),
    stopSpeaking: () => invoke("stop_speaking"),
    stopVoiceSession: () => invoke("stop_voice_session"),
    onSttFinal: (handler) => listen("stt:final", handler),
    onVoiceStatus: (handler) => listen("voice:status", handler),
    onShowModelSetup: (handler) => listen("pillarpress:show-model-setup", handler),
    onBackupCreated: (handler) => listen("pillarpress:backup-created", handler),
  };
})();
