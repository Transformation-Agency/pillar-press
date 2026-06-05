/* ============================================================
   Generators — Proposed Revision + platform-native versions.
   Plain JS. Exposes window.GEN.
   ============================================================ */
(function () {

  /* ---------- Proposed Revision ----------
     Applies ONLY clarity, tone, and inoculation (screenshot-test) findings.
     Strategy / audience / rigor / identity findings stay in the report.
     Rule: where a clarity rule would flatten a line that sounds like the
     author, the author's line wins. Ends with a changelog.

     Uses a DELIMITER format (not JSON) so long revised text with line
     breaks never breaks parsing, and processes the draft in passages so
     no single call exceeds the output budget — this scales to any length. */

  function chunkText(text, maxWords = 260) {
    const paras = (text || "").split(/\n{2,}/);
    const chunks = []; let cur = []; let curW = 0;
    const flush = () => { if (cur.length) { chunks.push(cur.join("\n\n")); cur = []; curW = 0; } };
    const wc = (s) => s.trim().split(/\s+/).filter(Boolean).length;
    for (const p of paras) {
      const w = wc(p);
      if (w > maxWords) {
        flush();
        const sents = p.match(/[^.!?]+[.!?]+[\s"”’)]*|[^.!?]+$/g) || [p];
        let sc = [], scw = 0;
        for (const s of sents) {
          const sw = wc(s);
          if (scw + sw > maxWords && sc.length) { chunks.push(sc.join("").trim()); sc = []; scw = 0; }
          sc.push(s); scw += sw;
        }
        if (sc.length) chunks.push(sc.join("").trim());
      } else if (curW + w > maxWords && cur.length) {
        flush(); cur.push(p); curW = w;
      } else { cur.push(p); curW += w; }
    }
    flush();
    return chunks.length ? chunks : [text || ""];
  }

  function parseDelimited(out) {
    let body = out || "", changelog = [];
    const rev = out.split(/@@\s*REVISION\s*@@/i);
    if (rev.length > 1) {
      const after = rev[1].split(/@@\s*CHANGELOG\s*@@/i);
      body = after[0];
      let cl = (after[1] || "").split(/@@\s*END\s*@@/i)[0];
      changelog = cl.split(/\n/).map((l) => l.trim())
        .filter((l) => /^[-•]/.test(l))
        .map((l) => {
          l = l.replace(/^[-•]\s*/, "");
          let finding = "—";
          const idm = l.match(/^\[?\s*([CTI]\s*\d+)\s*\]?/i);
          if (idm) { finding = idm[1].replace(/\s+/g, "").toUpperCase(); l = l.slice(idm[0].length); }
          l = l.replace(/^\s*\[[^\]]*\]\s*/, ""); // drop an optional [severity] tag
          const parts = l.split(/\s*::\s*/);
          return { finding, change: (parts[0] || "").replace(/^[—:\-\s]+/, "").trim(), note: (parts[1] || "").trim() };
        }).filter((c) => c.change);
    }
    body = body.replace(/@@\s*END\s*@@[\s\S]*$/i, "").replace(/@@\s*CHANGELOG\s*@@[\s\S]*$/i, "").trim();
    return { revision: body, changelog };
  }

  async function generateRevision(piece, refCtx, onProgress) {
    const packet = piece.packet || {};
    const clarity = (packet.clarity && packet.clarity.findings) || [];
    const tone = (packet.tone && packet.tone.findings) || [];
    const inoc = (packet.stress && packet.stress.screenshotTests) || [];

    const findingsBlock = [
      "CLARITY FINDINGS:",
      ...clarity.map((f, i) => `C${i + 1} [${f.severity}] ${f.title} — ${f.detail}${f.anchor ? ` (re: "${f.anchor}")` : ""}`),
      "\nTONE FINDINGS:",
      ...tone.map((f, i) => `T${i + 1} [${f.severity}] ${f.title} — ${f.detail}${f.anchor ? ` (re: "${f.anchor}")` : ""}`),
      "\nINOCULATIONS (from screenshot test):",
      ...inoc.map((s, i) => `I${i + 1} re "${s.quote}": ${s.inoculation}`),
    ].join("\n");

    const system =
`You are the reviser in an editorial system for a single author. You revise ONE PASSAGE of a longer piece at a time. For the passage you are given:
(a) PRESERVE the author's structure and register;
(b) apply ONLY the clarity, tone, and inoculation findings that are relevant to THIS passage — do NOT act on strategy, audience, rigor, or identity concerns;
(c) obey absolutely: where a clarity rule would flatten a line that sounds like the author, the AUTHOR'S LINE WINS — keep it verbatim;
(d) make the smallest changes that satisfy the findings; if the passage needs no change, return it unchanged with an empty changelog.

AUTHOR REFERENCES:
${refCtx}

Return EXACTLY this format and NOTHING else (no JSON, no preamble):
@@REVISION@@
<the revised passage as plain prose; keep paragraph breaks as blank lines>
@@CHANGELOG@@
- [findingId] what changed :: short why
@@END@@
(One changelog line per change. findingId is like C2, T1, or I3. Omit the line entirely if nothing changed.)`;

    const chunks = chunkText(piece.original, 260);
    const revisions = [];
    let changelog = [];
    for (let i = 0; i < chunks.length; i++) {
      if (onProgress) onProgress(i, chunks.length);
      const prompt =
`FINDINGS AVAILABLE (apply only those relevant to this passage):
${findingsBlock}

PASSAGE ${i + 1} OF ${chunks.length}:
"""${chunks[i]}"""

Return the delimited format now.`;
      try {
        const out = await window.AI.text(prompt, { system });
        const parsed = parseDelimited(out);
        revisions.push((parsed.revision && parsed.revision.length > 2) ? parsed.revision : chunks[i]);
        changelog = changelog.concat(parsed.changelog);
      } catch (e) {
        console.warn("Revision passage failed, keeping original:", i, e);
        revisions.push(chunks[i]);
      }
    }
    if (onProgress) onProgress(chunks.length, chunks.length);
    return { revision: revisions.join("\n\n"), changelog };
  }

  /* ---------- Platform generation ---------- */

  const AUDIENCE_PRESETS = [
    { id: "leaders", name: "Leaders in personal spheres" },
    { id: "builders", name: "Builders & founders" },
    { id: "women-ai", name: "Women curious about AI" },
    { id: "governance", name: "Governance & coordination thinkers" },
    { id: "relational", name: "Existing relational audience" },
    { id: "general", name: "General public bridge" },
  ];

  // Fixed generation order. Each platform names which prior outputs it
  // prefers to derive from; falls back to canonical source if absent.
  const PLATFORMS = [
    { id: "substack", name: "Substack", order: 1, register: "essay",
      derivesFrom: [], role: "Canonical source. The fullest expression — long-form essay register." },
    { id: "facebook", name: "Facebook", order: 2, register: "field",
      derivesFrom: ["substack"], role: "Relational adaptation of the canonical source. Warm, personal, field register." },
    { id: "instagram", name: "Instagram", order: 3, register: "field",
      derivesFrom: ["facebook"], role: "Visual adaptation of the Facebook version. Include image/carousel/Reel recommendation." },
    { id: "x", name: "X", order: 4, register: "field",
      derivesFrom: ["substack", "facebook"], role: "Strongest theses and distinctions from the Substack + Facebook versions. Thread-friendly." },
    { id: "threads", name: "Threads", order: 5, register: "field",
      derivesFrom: ["facebook", "x"], role: "Conversational register, built from the Facebook + X versions." },
  ];

  function canonicalSource(piece) {
    if (piece.revision && piece.revision.text) return piece.revision.text;
    if (piece.revision && piece.revision.revision) return piece.revision.revision;
    return piece.original || "";
  }

  // Resolve, given the set of ON platforms, the actual source for each.
  // If a platform's preferred derivesFrom isn't ON, fall back up the chain
  // to canonical source.
  function resolveSources(activeIds) {
    const map = {};
    PLATFORMS.forEach((p) => {
      if (!activeIds.includes(p.id)) return;
      const present = p.derivesFrom.filter((d) => activeIds.includes(d));
      map[p.id] = present.length ? present : ["__source__"];
    });
    return map;
  }

  async function generatePlatform(platform, { sourceText, priorOutputs, sourceIds, audienceId, refCtx }) {
    const aud = AUDIENCE_PRESETS.find((a) => a.id === audienceId) || AUDIENCE_PRESETS[0];

    let derivationText;
    if (sourceIds[0] === "__source__") {
      derivationText = `Derive from the CANONICAL SOURCE below.`;
    } else {
      derivationText = `Derive from these already-generated versions (named): ${sourceIds.map((s) => s.toUpperCase()).join(" + ")}. Use their strongest material. Do NOT merely excerpt — this is an independent entry point that may point back to the longer work.`;
    }

    const priorBlock = sourceIds[0] === "__source__"
      ? `CANONICAL SOURCE:\n"""${sourceText}"""`
      : sourceIds.map((s) => `=== ${s.toUpperCase()} VERSION ===\n${(priorOutputs[s] && priorOutputs[s].draftPost) || sourceText}`).join("\n\n");

    const igExtra = platform.id === "instagram"
      ? ` For Instagram, the imagery recommendation MUST specify a format: single image, carousel (with slide breakdown), or Reel (with a short beat list).`
      : "";

    /* --- Call 1: the POST BODY (delimiter format, no JSON escaping) ---
       Kept separate from the metadata so a long body can never truncate the
       structured fields. Distill rather than reproduce. */
    const bodySystem =
`You write the BODY of a single platform-native post for an author. ${platform.role}
Register to use: ${platform.register}. ${derivationText}
This is an INDEPENDENT entry point, never a mere excerpt; it may point back to the longer work. If the source is long, DISTILL it to one sharp idea rather than reproducing it — aim for a complete, well-shaped post and do not exceed ~550 words.

AUTHOR REFERENCES:
${refCtx}

Return EXACTLY this and nothing else (no JSON, no preamble):
@@POST@@
<the full post as plain prose; keep paragraph breaks as blank lines>
@@END@@`;
    const bodyPrompt =
`TARGET PLATFORM: ${platform.name}
SELECTED AUDIENCE: ${aud.name}

${priorBlock}

Write the post now in the delimited format.`;
    const bodyOut = await window.AI.text(bodyPrompt, { system: bodySystem });
    let draftPost = bodyOut || "";
    const pm = bodyOut.split(/@@\s*POST\s*@@/i);
    if (pm.length > 1) draftPost = pm[1].split(/@@\s*END\s*@@/i)[0];
    draftPost = draftPost.replace(/@@\s*END\s*@@[\s\S]*$/i, "").trim();

    /* --- Call 2: the METADATA (compact JSON, given the finished body) --- */
    const metaSystem =
`You produce publishing metadata for a FINISHED platform post written for an author. Base every field on the actual post text provided. Run a risk & boundary check against the author's RED LINES.

AUTHOR REFERENCES:
${refCtx}

Return ONLY compact valid JSON (no prose, no code fences):
{"throughlineTag":"<one throughline tag, no hash>","strategicPurpose":"1 sentence","hooks":["2-3 short alternative opening hooks"],"ctas":["2-3 call-to-action options"],"mediaRec":"<imagery/media recommendation${platform.id === "instagram" ? ", specify single image / carousel / Reel" : ""}>","riskCheck":"<'Clear' or the specific concern>","relatedOffering":"<related offering or destination>","followUp":"<one suggested follow-up post>"}`;
    const metaPrompt =
`PLATFORM: ${platform.name}
SELECTED AUDIENCE: ${aud.name}${igExtra}

THE POST:
"""${draftPost}"""

Return the metadata JSON now.`;
    let meta = {};
    try { meta = await window.AI.json(metaPrompt, { system: metaSystem }); }
    catch (e) { console.warn("Platform metadata failed:", platform.id, e); }

    return {
      platform: platform.name,
      selectedAudience: aud.name,
      throughlineTag: (meta.throughlineTag || "").replace(/^#/, "") || "—",
      strategicPurpose: meta.strategicPurpose || "—",
      draftPost: draftPost || "—",
      hooks: Array.isArray(meta.hooks) ? meta.hooks : [],
      ctas: Array.isArray(meta.ctas) ? meta.ctas : [],
      mediaRec: meta.mediaRec || "—",
      riskCheck: meta.riskCheck || "Clear",
      relatedOffering: meta.relatedOffering || "—",
      followUp: meta.followUp || "—",
      _platform: platform.id,
      _audienceId: aud.id,
    };
  }

  // Orchestrate full generation in fixed order, threading prior outputs.
  async function generateOutputs(piece, activeIds, audienceMap, refCtx, onProgress) {
    const ordered = PLATFORMS.filter((p) => activeIds.includes(p.id));
    const sources = resolveSources(activeIds);
    const sourceText = canonicalSource(piece);
    const outputs = {};
    const order = [];
    for (const platform of ordered) {
      if (onProgress) onProgress(platform.id, "running");
      try {
        const res = await generatePlatform(platform, {
          sourceText,
          priorOutputs: outputs,
          sourceIds: sources[platform.id],
          audienceId: audienceMap[platform.id],
          refCtx,
        });
        outputs[platform.id] = res;
        order.push(platform.id);
        if (onProgress) onProgress(platform.id, "done", res);
      } catch (e) {
        if (onProgress) onProgress(platform.id, "error", null, e);
        throw e;
      }
    }
    return { outputs, order };
  }

  window.GEN = {
    generateRevision,
    generateOutputs,
    generatePlatform,
    resolveSources,
    canonicalSource,
    AUDIENCE_PRESETS,
    PLATFORMS,
  };
})();
