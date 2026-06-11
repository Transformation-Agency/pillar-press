/* Deterministic first-run onboarding copy. This is app-owned product language,
   not model output. Keep copy versioned so future changes are intentional. */
(function () {
  const AUDIO_INTRO_COPY_VERSION = "2026-06-10.pillar-press-orientation.v1";

  const PRESS_BRAND_LABEL = {
    pillar_press: "Pillar Press",
    kings_press: "Pillar Press",
  };

  function getAudioReadyPrompt() {
    return [
      "Audio is connected.",
      "You can speak or type from here.",
    ].join("\n\n");
  }

  function getPressIntroScript(brand) {
    const name = PRESS_BRAND_LABEL[brand] || PRESS_BRAND_LABEL.pillar_press;
    return [
      "I’m " + name + ".",
      "I’m here to help you articulate your thoughts and format them for the places where you communicate most — posts, essays, newsletters, articles, scripts, book drafts, or internal notes.",
      "My job is to learn how you communicate when you’re being most yourself, then help you do that consistently.",
      "You stay in control. I can use your voice, your source material, and your preferred platforms, but I’ll ask before I use memory, publish, send, or connect to outside services.",
      "To start, tell me where you communicate most.",
    ].join("\n\n");
  }

  const FIRST_PLATFORM_QUESTION =
    "Where do you communicate most? You can say things like Facebook, LinkedIn, X, Substack, newsletters, email, articles, scripts, book chapters, internal memos, or something else.";

  window.KP_ONBOARDING_COPY = {
    AUDIO_INTRO_COPY_VERSION,
    PRESS_BRAND_LABEL,
    getAudioReadyPrompt,
    getPressIntroScript,
    FIRST_PLATFORM_QUESTION,
  };
})();
