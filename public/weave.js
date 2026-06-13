/* ============================================================
   Weave — multi-file synthesis engine (map-reduce).
   Plain JS. Exposes window.WEAVE.

   Server-side map-reduce synthesis. On desktop the browser kicks a
   background job (?async=1) and polls it for real phase progress; in
   hosted/browser mode it posts synchronously with coarse progress
   (the in-memory job store isn't shared across serverless instances).
   ============================================================ */
(function () {

  function isDesktop() {
    return !!(window.PILLAR_DESKTOP && window.PILLAR_DESKTOP.isDesktop && window.PILLAR_DESKTOP.isDesktop());
  }

  async function postWeave(usable, asyncMode) {
    const res = await fetch("/api/weave" + (asyncMode ? "?async=1" : ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: usable.map((s) => ({ name: s.name, text: s.text })) }),
    });
    if (!res.ok) {
      let msg = "Weave failed.";
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  }

  function normalizeResult(data) {
    return {
      extracts: data.extracts || [],
      brief: data.brief || {},
      mapping: data.mapping || { mapped: [], nearestAngle: null, audience: "", register: "essay" },
      draft: data.draft || "",
      generatedAt: data.generatedAt || Date.now(),
    };
  }

  // Background job path: poll /api/weave/:id and forward the server's real
  // WeaveProgress ({phase, i, total, name}) to onProgress.
  async function runWeaveAsync(usable, onProgress) {
    const started = await postWeave(usable, true);
    const jobId = started && started.jobId;
    if (!jobId) throw new Error("Weave failed to start.");
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch("/api/weave/" + encodeURIComponent(jobId), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("Weave job was lost (did the app restart?). Run it again.");
      const job = await res.json();
      if (job.progress && onProgress) onProgress(job.progress);
      if (job.status === "done") return normalizeResult(job.result || {});
      if (job.status === "error") throw new Error(job.error || "Weave failed.");
    }
  }

  async function runWeave(sources, refCtx, onProgress) {
    const all = sources || [];
    const usable = all.filter((s) => (s.text || "").trim().length > 20);
    if (usable.length < 2) throw new Error("Add at least two sources with content to weave.");

    if (onProgress) onProgress({ phase: "extract", i: 0, total: usable.length, name: usable[0].name });

    if (isDesktop()) {
      const result = await runWeaveAsync(usable, onProgress);
      if (onProgress) onProgress({ phase: "done" });
      return result;
    }

    // Coarse progress for hosted mode (one synchronous server call).
    if (onProgress) onProgress({ phase: "brief" });
    if (onProgress) onProgress({ phase: "map" });
    if (onProgress) onProgress({ phase: "draft", i: 0, total: 1, name: "draft" });

    const data = await postWeave(usable, false);
    if (onProgress) onProgress({ phase: "done" });
    return normalizeResult(data);
  }

  window.WEAVE = { runWeave };
})();
