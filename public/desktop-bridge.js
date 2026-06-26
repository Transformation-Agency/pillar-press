/* Pillar Press desktop bridge.
   Bundled by scripts/build-static-browser-shell.ts for the Tauri app. */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

(function () {
  function isDesktop() {
    return !!(
      window.__TAURI_INTERNALS__ &&
      typeof window.__TAURI_INTERNALS__.invoke === "function"
    );
  }

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
    return tauriInvoke(command, clean(args || {}));
  }

  async function listen(name, handler) {
    if (!isDesktop()) return function () {};
    return tauriListen(name, handler);
  }

  window.PILLAR_DESKTOP = {
    isDesktop,
    ollamaStatus: () => invoke("ollama_status"),
    startOllama: () => invoke("start_ollama_service"),
    openOllamaDownload: () => invoke("open_ollama_download"),
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
    appVersion: () => invoke("desktop_app_version"),
    checkForUpdates: async () => {
      if (!isDesktop()) return null;
      const update = await check();
      return update || null;
    },
    downloadAndInstallUpdate: async (update, onProgress) => {
      if (!update) throw new Error("No update is available.");
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (!onProgress) return;
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
          onProgress({ status: "started", downloaded, total });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength || 0;
          onProgress({ status: "downloading", downloaded, total });
        } else if (event.event === "Finished") {
          onProgress({ status: "finished", downloaded, total });
        }
      });
    },
    restartApp: () => relaunch(),
    startVoiceSession: () => invoke("start_voice_session"),
    speakText: (text, options) => invoke("speak_text", { args: { text, interrupt: !!(options && options.interrupt) } }),
    stopSpeaking: () => invoke("stop_speaking"),
    stopVoiceSession: () => invoke("stop_voice_session"),
    onSttFinal: (handler) => listen("stt:final", handler),
    onShowModelSetup: (handler) => listen("pillarpress:show-model-setup", handler),
    onBackupCreated: (handler) => listen("pillarpress:backup-created", handler),
  };
})();
