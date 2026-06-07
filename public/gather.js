/* ============================================================
   Gather — research ingestion surface.

   Connectors (RSS, web search, database scrape, journal library,
   X trending, YouTube transcripts) all require server-side fetching
   with keys + CORS that a browser prototype can't do. So in-app the
   run is SIMULATED: it asks the model for plausible, clearly-labeled
   DEMO items relevant to the campaign's focus — useful as seed
   material to pipe into Weave. The real connectors live in the
   backend handoff package. Plain JS. Exposes window.GATHER.
   ============================================================ */
(function () {

  const SOURCE_KINDS = {
    rss:      { id: "rss",      label: "RSS / News feed", icon: "rss",   field: "url",   placeholder: "https://www.example-news.com/feed.xml", hint: "A news or blog RSS feed.", noun: "feed" },
    web:      { id: "web",      label: "Web search",      icon: "globe", field: "query", placeholder: "search terms…",                          hint: "A web search query.", noun: "query" },
    database: { id: "database", label: "Database scrape", icon: "db",    field: "query", placeholder: "site or dataset + what to pull",          hint: "A database / site to query.", noun: "query" },
    journal:  { id: "journal",  label: "Journal library", icon: "book",  field: "query", placeholder: "topic, author, or DOI",                   hint: "Verified academic libraries (Crossref / PubMed / arXiv).", noun: "query" },
    x:        { id: "x",        label: "X trending",      icon: "xLogo", field: "query", placeholder: "#topic or @handle",                       hint: "A trending topic or handle on X.", noun: "topic" },
    youtube:  { id: "youtube",  label: "YouTube transcript", icon: "film", field: "url", placeholder: "https://youtube.com/watch?v=…",          hint: "A video to transcribe.", noun: "video" },
  };

  const ORDER = ["rss", "web", "journal", "database", "x", "youtube"];

  function kindList() { return ORDER.map((k) => SOURCE_KINDS[k]); }

  async function runSource(source, refCtx) {
    const k = SOURCE_KINDS[source.kind];
    const want = source.kind === "youtube" ? 1 : 3;
    const transcriptField = source.kind === "youtube"
      ? `,"transcript":"<a 2-4 sentence excerpt of what such a video's transcript might say>"` : "";
    const system =
`You SIMULATE a "${k.label}" research connector for a product demo. Produce ${want} plausible, ILLUSTRATIVE item(s) such a connector might surface for the input below, slanted toward the author's focus so they're useful research seeds.
These are DEMO placeholders — do NOT invent real URLs, real article IDs, or real people's quotes. Use generic source names and example.com URLs. Keep snippets to 1-3 sentences.

AUTHOR FOCUS (bias items toward these throughlines/audiences):
${refCtx}

Return ONLY JSON: {"items":[{"title":"…","source":"<generic publication/source name>","author":"<name or null>","date":"<e.g. 2026-05>","url":"https://example.com/…","snippet":"…"${transcriptField}}]}`;
    const prompt = `${k.label} input (${k.field}): ${source.config || "(unspecified)"}\n\nReturn the JSON.`;
    const res = await window.AI.json(prompt, { system });
    return (res.items || []).map((it) => ({
      kind: source.kind,
      sourceId: source.id,
      sourceLabel: source.label || k.label,
      title: it.title || "Untitled",
      source: it.source || k.label,
      author: it.author || null,
      date: it.date || "",
      url: it.url || "https://example.com",
      snippet: it.snippet || "",
      transcript: it.transcript || null,
      demo: true,
    }));
  }

  // same-origin REST helpers (no auth headers; auth is skip-login)
  async function apiGet(path) {
    const r = await fetch("/api" + path, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("GET " + path + " -> " + r.status);
    return r.json();
  }
  async function apiPost(path, body) {
    const r = await fetch("/api" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error("POST " + path + " -> " + r.status);
    const ct = r.headers.get("content-type") || "";
    return ct.indexOf("application/json") >= 0 ? r.json() : null;
  }

  // Replace this campaign's cached gather items with server truth, then emit.
  // Uses addGatherItems (which emits) after dropping the stale cache so a
  // re-run replaces rather than accumulates.
  function refreshGatherItems(campaignId, items) {
    const st = window.Store.getState();
    if (!Array.isArray(st.gatherItems)) st.gatherItems = [];
    // drop this campaign's stale cache without firing server DELETEs
    st.gatherItems = st.gatherItems.filter((i) => i.campaignId !== campaignId);
    // add server items (addGatherItems emits a single re-render)
    if (items.length) return window.Store.addGatherItems(items);
    window.Store.addGatherItems([]); // emit even when empty so the UI clears
    return [];
  }

  async function runGather(sources, refCtx, onProgress) {
    const campaignId = window.Store.getState().activeCampaignId;
    if (!campaignId) throw new Error("Select a campaign first.");
    const enabled = (sources || []).filter((s) => s.enabled && (s.config || "").trim());
    if (!enabled.length) throw new Error("Add at least one source with a value, and enable it.");

    if (onProgress) onProgress({ label: "all sources", i: 0, total: 1 });

    // Server runs the campaign's enabled sources and persists items.
    const runRes = await apiPost("/gather/run", { campaignId });
    const perSource = (runRes && runRes.perSource) || null;

    // Refresh from server truth so the UI shows the persisted items.
    let items = (runRes && runRes.items) || null;
    if (!Array.isArray(items)) {
      const itemRes = await apiGet("/gather/items?campaignId=" + encodeURIComponent(campaignId));
      items = (itemRes && itemRes.items) || [];
    }

    // best-effort: stamp lastRun / lastCount on each enabled source
    enabled.forEach((s) => {
      const count = perSource && perSource[s.id] != null
        ? (Array.isArray(perSource[s.id]) ? perSource[s.id].length : perSource[s.id])
        : items.filter((it) => it.sourceId === s.id).length;
      window.Store.updateGatherSource(s.id, { lastRun: Date.now(), lastCount: count });
    });

    refreshGatherItems(campaignId, items);

    // Per-source research briefs (one independent LLM call each, server-side).
    const summaries = (runRes && runRes.summaries) || [];
    window.Store.setGatherSummaries(campaignId, summaries);

    if (onProgress) onProgress({ done: true });
    return items;
  }

  // Turn a gathered item into text for Weave.
  function itemToText(it) {
    return [
      it.title,
      `(${it.source}${it.author ? " · " + it.author : ""}${it.date ? " · " + it.date : ""})`,
      "",
      it.transcript || it.snippet,
    ].join("\n");
  }

  window.GATHER = { SOURCE_KINDS, kindList, runSource, runGather, itemToText };
})();
