/* ============================================================
   Weave — multi-file synthesis engine (map-reduce).
   Plain JS. Exposes window.WEAVE.

   Server-side map-reduce synthesis. The browser only posts sources to
   /api/weave and renders coarse progress.
   ============================================================ */
(function () {

  async function runWeave(sources, refCtx, onProgress) {
    const all = sources || [];
    const usable = all.filter((s) => (s.text || "").trim().length > 20);
    if (usable.length < 2) throw new Error("Add at least two sources with content to weave.");

    // Coarse progress for UI (the heavy map-reduce now runs server-side in one call).
    if (onProgress) onProgress({ phase: "extract", i: 0, total: usable.length, name: usable[0].name });
    if (onProgress) onProgress({ phase: "brief" });
    if (onProgress) onProgress({ phase: "map" });
    if (onProgress) onProgress({ phase: "draft", i: 0, total: 1, name: "draft" });

    const res = await fetch("/api/weave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: usable.map((s) => ({ name: s.name, text: s.text })) }),
    });
    if (!res.ok) {
      let msg = "Weave failed.";
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const data = await res.json();

    if (onProgress) onProgress({ phase: "done" });

    return {
      extracts: data.extracts || [],
      brief: data.brief || {},
      mapping: data.mapping || { mapped: [], nearestAngle: null, audience: "", register: "essay" },
      draft: data.draft || "",
      generatedAt: data.generatedAt || Date.now(),
    };
  }

  window.WEAVE = { runWeave };
})();
