/* ============================================================
   AI helpers — JSON parsing + reference context only.
   Model calls are server-side through /api routes.
   ============================================================ */
(function () {

  function extractJSON(text) {
    if (!text) return null;
    // strip code fences
    let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    // direct parse
    try { return JSON.parse(t); } catch (e) {}
    // find first balanced { ... } or [ ... ]
    const start = t.search(/[{\[]/);
    if (start === -1) return null;
    const open = t[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === open) depth++;
        else if (c === close) { depth--; if (depth === 0) {
          const slice = t.slice(start, i + 1);
          try { return JSON.parse(slice); } catch (e) { return null; }
        } }
      }
    }
    return null;
  }

  // Attempt to recover a usable object from TRUNCATED JSON by closing
  // open strings/brackets, then progressively dropping trailing fields.
  function closeBalanced(s) {
    const stack = []; let inStr = false, esc = false, out = "";
    for (const c of s) {
      out += c;
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
      else { if (c === '"') inStr = true; else if (c === "{") stack.push("}"); else if (c === "[") stack.push("]"); else if (c === "}" || c === "]") stack.pop(); }
    }
    if (inStr) out += '"';
    out = out.replace(/[,:]\s*$/, "");
    for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
    try { return JSON.parse(out); } catch (e) { return null; }
  }

  function repairJSON(text) {
    if (!text) return null;
    const start = text.search(/[{\[]/);
    if (start < 0) return null;
    const s = text.slice(start);
    let r = closeBalanced(s);
    if (r) return r;
    let idx = s.length;
    for (let k = 0; k < 60; k++) {
      idx = s.lastIndexOf(",", idx - 1);
      if (idx < 0) break;
      r = closeBalanced(s.slice(0, idx));
      if (r) return r;
    }
    return null;
  }

  function cleanSetupText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength || 360);
  }

  function setupStringList(value, maxItems) {
    return Array.isArray(value)
      ? value.map((item) => cleanSetupText(item, 120)).filter(Boolean).slice(0, maxItems || 5)
      : [];
  }

  function buildSetupProfileBlock(profile) {
    if (!profile || typeof profile !== "object") return [];
    const voice = profile.voiceProfile && typeof profile.voiceProfile === "object" ? profile.voiceProfile : {};
    const publication = profile.publicationDefaults && typeof profile.publicationDefaults === "object" ? profile.publicationDefaults : {};
    const permissions = profile.permissions && typeof profile.permissions === "object" ? profile.permissions : {};
    const lines = ["\nAPPROVED SETUP PROFILE:"];
    const selfStatement = cleanSetupText(profile.selfStatement || voice.userDescription);
    if (selfStatement) lines.push("Self statement: " + selfStatement);
    const platforms = Array.isArray(profile.communicationPlatforms)
      ? profile.communicationPlatforms
          .map((item) => cleanSetupText(item && (item.platform || item.name || item), 80))
          .filter(Boolean)
          .slice(0, 6)
      : [];
    if (platforms.length) lines.push("Communication platforms: " + platforms.join(", "));
    const outputTypes = setupStringList(publication.defaultOutputTypes, 8);
    if (outputTypes.length) lines.push("Writing formats: " + outputTypes.join(", "));
    const toneWords = setupStringList(voice.toneWords, 8);
    if (toneWords.length) lines.push("Tone words: " + toneWords.join(", "));
    const avoid = setupStringList(voice.avoid, 8);
    if (avoid.length) lines.push("Avoid: " + avoid.join(", "));
    const preservation = cleanSetupText(publication.preserveRawLanguage, 80);
    if (preservation) lines.push("Preservation preference: " + preservation);
    lines.push(
      "Permissions: memory=" + (permissions.mayUseSavedMemory ? "approved" : "not approved") +
        "; examples=" + (permissions.mayUseUploadedVoiceExamples ? "approved" : "not approved") +
        "; web=" + (permissions.mayUseWebResearch ? "approved" : "not approved") +
        "; publish/send=not approved"
    );
    return lines;
  }

  // Build a compact reference context block the gates/generators read.
  function refContext(refs) {
    const r = refs || (window.Store && window.Store.activeReferences()) || {};
    const lines = [];
    if (r.strategy) {
      lines.push("THROUGHLINES:");
      (r.strategy.throughlines || []).forEach((t) => lines.push(`- [${t.tag}] ${t.name}: ${t.note}`));
      if (r.strategy.body) lines.push("Strategy note: " + r.strategy.body);
    }
    if (r.audiences) {
      lines.push("\nAUDIENCES:");
      (r.audiences.list || []).forEach((a) => lines.push(`- [${a.id}] ${a.name}: ${a.note}`));
    }
    if (r.registers) {
      lines.push("\nREGISTERS:");
      (r.registers.list || []).forEach((x) => lines.push(`- [${x.id}] ${x.name}: ${x.note}`));
      if (r.registers.body) lines.push(r.registers.body);
    }
    if (r.voiceRules) {
      lines.push("\nCLARITY RULES:");
      (r.voiceRules.rules || []).forEach((x, i) => lines.push(`${i + 1}. ${x}`));
    }
    if (r.redLines) {
      lines.push("\nRED LINES:");
      (r.redLines.rules || []).forEach((x) => lines.push(`- ${x}`));
    }
    if (r.selfVision && r.selfVision.body) {
      lines.push("\nSELF-VISION (public identity):\n" + r.selfVision.body);
    }
    if (r.gateSpec && r.gateSpec.body) {
      lines.push("\nGATE PREFERENCES:\n" + r.gateSpec.body);
    }
    if (r.setupProfile && r.setupProfile.profile) {
      lines.push.apply(lines, buildSetupProfileBlock(r.setupProfile.profile));
    }
    return lines.join("\n");
  }

  window.AI = { extractJSON, repairJSON, refContext };
})();
