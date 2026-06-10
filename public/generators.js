/* ============================================================
   Generators — Proposed Revision + platform-native versions.
   Plain JS. Exposes window.GEN.
   ============================================================ */
(function () {

  /* ---- minimal REST helper (same-origin, no auth headers) ---- */
  async function apiSend(method, path, body) {
    const r = await fetch("/api" + path, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(method + " " + path + " -> " + r.status);
    const ct = r.headers.get("content-type") || "";
    return ct.indexOf("application/json") >= 0 ? r.json() : null;
  }

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

  async function generateRevision(piece, refCtx, onProgress, opts) {
    // Revision is produced server-side: POST /api/pieces/:id/revision
    // returns { piece } with piece.revision = { text, changelog }.
    // opts.mode "full" runs a whole-document restructure (strategy/structure/
    // etc.) before the per-passage clarity/tone/inoculation polish.
    const body = opts && opts.mode ? { mode: opts.mode } : null;
    const res = await apiSend("POST", "/pieces/" + piece.id + "/revision", body);
    const rev = (res && res.piece && res.piece.revision) || {};
    if (onProgress) onProgress(1, 1);
    return {
      revision: rev.text || "",
      changelog: Array.isArray(rev.changelog) ? rev.changelog : [],
    };
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

  // Generate platform-native versions server-side in fixed order.
  // POST /api/pieces/:id/outputs { active, audiences } -> { piece, outputs, outputOrder }.
  async function generateOutputs(piece, activeIds, audienceMap, refCtx, onProgress) {
    const ordered = PLATFORMS.filter((p) => activeIds.includes(p.id)).map((p) => p.id);
    // Server does the whole batch in one call; flag each ordered platform as running.
    if (onProgress) ordered.forEach((id) => onProgress(id, "running"));
    let res;
    try {
      res = await apiSend("POST", "/pieces/" + piece.id + "/outputs", {
        active: activeIds,
        audiences: audienceMap,
      });
    } catch (e) {
      if (onProgress) ordered.forEach((id) => onProgress(id, "error", null, e));
      throw e;
    }
    const outputs = (res && res.outputs) || (res && res.piece && res.piece.outputs) || {};
    const order = (res && res.outputOrder) || (res && res.piece && res.piece.outputOrder) || ordered.filter((id) => outputs[id]);
    if (onProgress) order.forEach((id) => { if (outputs[id]) onProgress(id, "done", outputs[id]); });
    return { outputs, order };
  }

  // Condense ONE output's post to ~(1-ratio) length, server-side. Returns
  // { platform, draftPost }. Does not touch hooks/CTAs/metadata.
  async function condenseOutput(pieceId, platform, ratio) {
    return apiSend("POST", "/pieces/" + pieceId + "/outputs/" + encodeURIComponent(platform) + "/condense", { ratio: ratio || 0.4 });
  }

  window.GEN = {
    generateRevision,
    generateOutputs,
    condenseOutput,
    resolveSources,
    canonicalSource,
    AUDIENCE_PRESETS,
    PLATFORMS,
  };
})();
