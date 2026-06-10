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
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      } catch (_err) {
        resolve();
      }
    });
  }

  window.KP_ONBOARDING_AUDIO = {
    classifyIntroConsent,
    getSpeechRecognitionCtor,
    speakText,
  };
})();
