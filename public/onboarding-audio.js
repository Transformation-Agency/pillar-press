/* Local audio-onboarding helpers. Consent classification stays deterministic. */
(function () {
  const YES_PATTERNS = [
    /\byes\b/i,
    /\byeah\b/i,
    /\byep\b/i,
    /\bsure\b/i,
    /\bokay\b/i,
    /\bok\b/i,
    /\bgo ahead\b/i,
    /\bintroduce yourself\b/i,
    /\btell me\b/i,
  ];

  const NO_PATTERNS = [
    /\bno\b/i,
    /\bskip\b/i,
    /\bnot now\b/i,
    /\blater\b/i,
    /\bdon't\b/i,
    /\bdo not\b/i,
  ];

  function classifyIntroConsent(transcript) {
    const text = String(transcript || "").trim();
    if (!text) return "unclear";
    if (NO_PATTERNS.some((pattern) => pattern.test(text))) return "no";
    if (YES_PATTERNS.some((pattern) => pattern.test(text))) return "yes";
    return "unclear";
  }

  function getSpeechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  async function microphonePermissionState() {
    try {
      const nav = window.navigator || (typeof navigator !== "undefined" ? navigator : null);
      if (!nav || !nav.permissions || !nav.permissions.query) return "unknown";
      const status = await nav.permissions.query({ name: "microphone" });
      return (status && status.state) || "unknown";
    } catch (_err) {
      return "unknown";
    }
  }

  async function requestMicrophonePermission() {
    const nav = window.navigator || (typeof navigator !== "undefined" ? navigator : null);
    const before = await microphonePermissionState();
    if (before === "denied") {
      throw new Error("Microphone permission is denied. Allow microphone access in system settings, then try again or keep typing.");
    }
    if (!nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) {
      throw new Error("Microphone access is not available here. You can keep typing instead.");
    }
    const stream = await nav.mediaDevices.getUserMedia({ audio: true });
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch (_err) {}
    return {
      microphone: "granted",
      before,
      after: await microphonePermissionState(),
    };
  }

  function speakText(text, options) {
    const body = String(text || "").trim();
    if (!body) return Promise.resolve();
    const desktop = window.KINGS_DESKTOP;
    if (desktop && desktop.isDesktop && desktop.isDesktop() && desktop.speakText) {
      return desktop.speakText(body, options || {}).catch(() => browserSpeakText(body, options));
    }
    return browserSpeakText(body, options);
  }

  function browserSpeakText(text, options) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        resolve();
        return;
      }
      try {
        if (options && options.interrupt) window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(text);
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      } catch (_err) {
        resolve();
      }
    });
  }

  function listenOnce(options) {
    const handlers = options || {};
    const Recognition = getSpeechRecognitionCtor();
    if (!Recognition) {
      if (handlers.onError) handlers.onError(new Error("Speech recognition is not available here."));
      return {
        supported: false,
        stop: function () {},
      };
    }

    let recognition;
    try {
      recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = handlers.lang || "en-US";
      recognition.onresult = function (event) {
        const results = event && event.results;
        const first = results && results[0] && results[0][0];
        const transcript = first && first.transcript ? String(first.transcript) : "";
        if (transcript.trim() && handlers.onFinal) handlers.onFinal(transcript.trim());
      };
      recognition.onerror = function (event) {
        if (handlers.onError) handlers.onError(new Error((event && event.error) || "Speech recognition failed."));
      };
      recognition.onend = function () {
        if (handlers.onEnd) handlers.onEnd();
      };
      recognition.start();
      return {
        supported: true,
        stop: function () {
          try { recognition.stop(); } catch (_err) {}
        },
      };
    } catch (err) {
      if (handlers.onError) handlers.onError(err);
      return {
        supported: false,
        stop: function () {},
      };
    }
  }

  window.KP_ONBOARDING_AUDIO = {
    classifyIntroConsent,
    getSpeechRecognitionCtor,
    microphonePermissionState,
    requestMicrophonePermission,
    speakText,
    listenOnce,
  };
})();
