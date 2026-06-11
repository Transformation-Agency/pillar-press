/* Deterministic onboarding profile helpers.
   These helpers turn user-provided setup answers into editable drafts. They do
   not grant permissions and do not treat user text as instructions. */
(function () {
  const PROFILE_VERSION = "2026-06-10.pillar-press-profile-draft.v1";

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
    const explicit = [];
    const lower = text.toLowerCase();
    if (/\bsocial media(?:\s+posts?)?\b/.test(lower)) explicit.push("Social media");
    if (/\blinkedin\b|\blinked in\b/.test(lower)) explicit.push("LinkedIn");
    if (/\bsubstack\b/.test(lower)) explicit.push("Substack");
    if (/\bnewsletter(s)?\b|\bemail(s)?\b/.test(lower)) explicit.push("Newsletter");
    if (/\barticle(s)?\b/.test(lower)) explicit.push("Article");
    if (/\bscript(s)?\b/.test(lower)) explicit.push("Scripts");
    if (/\bbook(s)?\b|\bbook chapter(s)?\b/.test(lower)) explicit.push("Book");
    if (/\bmemo(s)?\b|\binternal memo(s)?\b/.test(lower)) explicit.push("Internal memo");
    if (explicit.length) {
      return explicit.filter((value, index, list) => list.indexOf(value) === index).slice(0, 6);
    }
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
      if (lower.includes("social media")) {
        ["linkedin_post", "x_post"].forEach((value) => {
          if (!outputs.includes(value)) outputs.push(value);
        });
      }
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
    if (profile && profile.draftStyle === "strategic") return "Strategic";
    if (profile && profile.draftStyle === "conversational") return "Conversational";
    if (profile && profile.draftStyle === "plainspoken") return "Plainspoken";
    if (profile && profile.draftStyle === "polished") return "Polished";
    if (preference === "preserve_heavily") return "Plainspoken";
    if (preference === "restructure_for_platform" || preference === "extract_and_rewrite") return "Strategic";
    return "Polished";
  }

  function cleanSentence(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^(where|that|which|who)\s+/i, "")
      .trim()
      .replace(/[.!?]+$/g, "");
  }

  function titleCase(value) {
    return cleanSentence(value).replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function lowerFirst(value) {
    const clean = cleanSentence(value);
    return clean ? clean.charAt(0).toLowerCase() + clean.slice(1) : clean;
  }

  function formatOutputType(value) {
    const labels = {
      facebook_post: "Facebook post",
      linkedin_post: "LinkedIn post",
      x_post: "X post",
      x_thread: "X thread",
      substack_essay: "Substack essay",
      newsletter: "newsletter",
      article: "article",
      script: "script",
      book_chapter: "book chapter",
      internal_note: "internal note",
      custom: "custom content",
    };
    return labels[value] || String(value || "").replace(/_/g, " ");
  }

  function inferTheme(text) {
    const source = String(text || "").trim();
    const patterns = [
      /\bmain theme is around\s+([^.!?]+)/i,
      /\btheme is around\s+([^.!?]+)/i,
      /\btheme is\s+([^.!?]+)/i,
      /\baround\s+([^.!?]+)/i,
      /\babout\s+([^.!?]+)/i,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match[1]) return cleanSentence(match[1]);
    }
    return "";
  }

  function inferPrimaryAudience(text, platforms, theme) {
    const source = String(text || "");
    const explicit = source.match(/\b(?:for|to)\s+((?!create|make|write|use|post|publish)[^.!?]{6,120})/i);
    if (explicit && explicit[1]) return titleCase(explicit[1]);
    const lowerTheme = String(theme || "").toLowerCase();
    if (lowerTheme.includes("ai")) return "People using AI in their work";
    if ((platforms || []).some((item) => /social/i.test(item))) return "Social media audience interested in " + (theme || "your point of view");
    return "";
  }

  function inferThroughline(text, theme) {
    const source = String(text || "").trim();
    const lower = source.toLowerCase();
    if (lower.includes("sovereignty") && lower.includes("ai")) {
      return "AI sovereignty means keeping humans in the loop, using AI productively, safely, and with discernment.";
    }
    if (theme) return titleCase(theme);
    return "";
  }

  function inferVoiceRules(text, throughline) {
    const lower = String(text || "").toLowerCase();
    const rules = [];
    if (lower.includes("human in the loop")) rules.push("Keep human judgment and agency at the center.");
    if (lower.includes("discernment")) rules.push("Center discernment, judgment, and thoughtful decision-making.");
    if (lower.includes("safely") || lower.includes("safe")) rules.push("Balance productivity with safety and responsibility.");
    if (lower.includes("sovereignty")) rules.push("Frame AI through sovereignty, ownership, and human control.");
    if (!rules.length && throughline) rules.push("Keep drafts anchored to: " + throughline);
    return rules;
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
    const platformNames = communicationPlatforms.map((item) => item.platform).filter(Boolean);
    const theme = inferTheme(transcript);
    const throughline = inferThroughline(transcript, theme);
    const primaryAudience = inferPrimaryAudience(transcript, platformNames, theme);
    const voiceRules = inferVoiceRules(transcript, throughline);

    return {
      version: PROFILE_VERSION,
      brand: "pillar_press",
      sourceTranscript: transcript,
      communicationPlatforms,
      selfStatement: throughline
        ? "Write with clarity and discernment about " + throughline.replace(/\.$/, "").toLowerCase() + "."
        : "",
      primaryAudience,
      throughline,
      draftStyle: platformNames.some((item) => /social/i.test(item)) ? "conversational" : (throughline ? "strategic" : "not_set"),
      voiceRules,
      redLines: [],
      writingHelpFirst: current.writingHelpFirst || "",
      voiceProfile: {
        userDescription: (current.voiceProfile && current.voiceProfile.userDescription) || (throughline ? "Clear, discerning, practical, and human-centered." : ""),
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
    const outputText = formatList(
      (profile.publicationDefaults && profile.publicationDefaults.defaultOutputTypes || []).map(formatOutputType),
      "custom content",
    );
    const throughline = cleanSentence(profile.throughline || "");
    const primaryAudience = cleanSentence(profile.primaryAudience || "");

    if (!String(draft.audienceName || "").trim() && primaryAudience) {
      draft.audienceName = primaryAudience;
    } else if (!String(draft.audienceName || "").trim() && platforms[0]) {
      draft.audienceName = platforms[0] + " audience";
    }
    if (!String(draft.audienceNote || "").trim()) {
      draft.audienceNote = primaryAudience
        ? "Write for " + lowerFirst(primaryAudience) + ", especially when preparing " + platformText + "."
        : "Primary publishing context: " + platformText + ".";
    }
    if (!String(draft.throughlineName || "").trim() && throughline) {
      draft.throughlineName = throughline;
    }
    if (!String(draft.throughlineNote || "").trim() && throughline) {
      draft.throughlineNote = throughline
        ? "Keep this point of view visible across drafts: " + throughline + "."
        : "Keep drafts anchored to the user's stated point of view and purpose.";
    }
    if (!String(draft.strategy || "").trim()) {
      draft.strategy = "Shape " + outputText + " for " + platformText + (throughline ? " around this throughline: " + throughline + "." : ".");
    }
    if (!String(draft.registerBody || "").trim()) {
      draft.registerBody = "Draft in a " + draftStyleForProfile(profile).toLowerCase() + " style that preserves the user's point of view and turns it into usable content.";
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
