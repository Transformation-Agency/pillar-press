/* Deterministic onboarding profile helpers.
   These helpers turn user-provided setup answers into editable drafts. They do
   not grant permissions and do not treat user text as instructions. */
(function () {
  const PROFILE_VERSION = "2026-06-10.kings-press-profile-draft.v1";

  const OUTPUT_BY_PLATFORM = {
    facebook: ["facebook_post"],
    linkedin: ["linkedin_post"],
    "linked in": ["linkedin_post"],
    x: ["x_post", "x_thread"],
    twitter: ["x_post", "x_thread"],
    substack: ["substack_essay", "newsletter"],
    newsletter: ["newsletter"],
    newsletters: ["newsletter"],
    email: ["newsletter"],
    article: ["article"],
    articles: ["article"],
    script: ["script"],
    scripts: ["script"],
    book: ["book_chapter"],
    "book chapter": ["book_chapter"],
    "book chapters": ["book_chapter"],
    memo: ["internal_note"],
    memos: ["internal_note"],
    "internal memo": ["internal_note"],
    "internal memos": ["internal_note"],
  };

  function cleanToken(value) {
    return String(value || "")
      .replace(/^mostly\s+/i, "")
      .replace(/^mainly\s+/i, "")
      .replace(/^on\s+/i, "")
      .trim()
      .replace(/[.!?]+$/g, "");
  }

  function displayPlatform(value) {
    const clean = cleanToken(value);
    const lower = clean.toLowerCase();
    if (lower === "x") return "X";
    if (lower === "twitter") return "X";
    if (lower === "linked in") return "LinkedIn";
    if (lower === "linkedin") return "LinkedIn";
    if (lower === "substack") return "Substack";
    if (lower === "facebook") return "Facebook";
    return clean.replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function parseCommunicationPlatforms(answer) {
    const text = String(answer || "").trim();
    if (!text) return [];
    return text
      .split(/,|;|\/|\.|\n|\band\b|\bplus\b|\balso\b/i)
      .map(cleanToken)
      .filter(Boolean)
      .filter((value) => !/\b(preserve|raw|polish|restructure|language|draft|style|voice)\b/i.test(value))
      .map(displayPlatform)
      .filter((value, index, list) => list.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
      .slice(0, 6);
  }

  function outputTypesForPlatforms(platforms) {
    const outputs = [];
    platforms.forEach((platform) => {
      const lower = String(platform || "").toLowerCase();
      Object.entries(OUTPUT_BY_PLATFORM).forEach(([key, values]) => {
        if (lower === key || lower.includes(key)) {
          values.forEach((value) => {
            if (!outputs.includes(value)) outputs.push(value);
          });
        }
      });
    });
    return outputs.length ? outputs : ["custom"];
  }

  function inferPreservationPreference(text) {
    const lower = String(text || "").toLowerCase();
    if (/\b(raw|verbatim|my language|preserve)\b/.test(lower)) return "preserve_heavily";
    if (/\b(restructure|adapt|repurpose|platform)\b/.test(lower)) return "restructure_for_platform";
    if (/\b(plainspoken|simple|light|polish)\b/.test(lower)) return "polish_lightly";
    return "polish_lightly";
  }

  function draftStyleForProfile(profile) {
    const preference = profile && profile.publicationDefaults && profile.publicationDefaults.preserveRawLanguage;
    if (preference === "preserve_heavily") return "Plainspoken";
    if (preference === "restructure_for_platform" || preference === "extract_and_rewrite") return "Strategic";
    return "Polished";
  }

  function buildProfileDraft(input) {
    const source = input || {};
    const transcript = String(source.transcript || source.answer || "").trim();
    const current = source.currentDraft || {};
    const platforms = parseCommunicationPlatforms(transcript);
    const currentPlatforms = Array.isArray(current.communicationPlatforms) ? current.communicationPlatforms : [];
    const communicationPlatforms = (platforms.length ? platforms : currentPlatforms.map((item) => item.platform).filter(Boolean))
      .map((platform, index) => ({
        platform,
        priority: index === 0 ? "primary" : "secondary",
        notes: transcript ? "Mentioned during setup." : "",
      }));
    const outputTypes = outputTypesForPlatforms(communicationPlatforms.map((item) => item.platform));

    return {
      version: PROFILE_VERSION,
      brand: "kings_press",
      sourceTranscript: transcript,
      communicationPlatforms,
      writingHelpFirst: current.writingHelpFirst || "",
      voiceProfile: {
        userDescription: (current.voiceProfile && current.voiceProfile.userDescription) || "",
        toneWords: (current.voiceProfile && current.voiceProfile.toneWords) || [],
        avoid: (current.voiceProfile && current.voiceProfile.avoid) || [],
        examplesPermission: (current.voiceProfile && current.voiceProfile.examplesPermission) || "not_asked",
        memoryPermission: "not_asked",
      },
      publicationDefaults: {
        defaultOutputTypes: outputTypes,
        preserveRawLanguage: inferPreservationPreference(transcript),
        humanReviewRequired: true,
      },
      permissions: {
        mayUseSavedMemory: false,
        mayUseUploadedVoiceExamples: false,
        mayUseWebResearch: false,
        mayPublishOrSend: false,
      },
    };
  }

  function formatList(items, fallback) {
    const list = (items || []).filter(Boolean);
    return list.length ? list.join(", ") : fallback;
  }

  function applyProfileToPreferences(profile, prefDraft) {
    const draft = Object.assign({}, prefDraft || {});
    if (!profile) return draft;
    const platforms = (profile.communicationPlatforms || []).map((item) => item.platform).filter(Boolean);
    const platformText = formatList(platforms, "your main channels");
    const outputText = formatList(profile.publicationDefaults && profile.publicationDefaults.defaultOutputTypes, "custom outputs");

    if (!String(draft.audienceName || "").trim() && platforms[0]) {
      draft.audienceName = platforms[0] + " readers";
    }
    if (!String(draft.audienceNote || "").trim()) {
      draft.audienceNote = "Communicates most on: " + platformText + ".";
    }
    if (!String(draft.throughlineName || "").trim()) {
      draft.throughlineName = "First setup focus";
    }
    if (!String(draft.throughlineNote || "").trim()) {
      draft.throughlineNote = "Initial setup answer: " + (profile.sourceTranscript || platformText) + ".";
    }
    if (!String(draft.strategy || "").trim()) {
      draft.strategy = "Shape drafts for " + platformText + " and prepare " + outputText.replace(/_/g, " ") + ".";
    }
    if (!String(draft.registerBody || "").trim()) {
      draft.registerBody = "Default draft style: " + draftStyleForProfile(profile).toLowerCase() + ".";
    }
    return draft;
  }

  window.KP_ONBOARDING_PROFILE = {
    PROFILE_VERSION,
    parseCommunicationPlatforms,
    outputTypesForPlatforms,
    inferPreservationPreference,
    draftStyleForProfile,
    buildProfileDraft,
    applyProfileToPreferences,
  };
})();
