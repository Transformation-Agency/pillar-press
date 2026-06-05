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

  async function runGather(sources, refCtx, onProgress) {
    const enabled = sources.filter((s) => s.enabled && (s.config || "").trim());
    if (!enabled.length) throw new Error("Add at least one source with a value, and enable it.");
    let all = [];
    for (let i = 0; i < enabled.length; i++) {
      const s = enabled[i];
      if (onProgress) onProgress({ sourceId: s.id, i, total: enabled.length, label: s.label || SOURCE_KINDS[s.kind].label });
      try {
        const items = await runSource(s, refCtx);
        window.Store.updateGatherSource(s.id, { lastRun: Date.now(), lastCount: items.length });
        all = all.concat(items);
      } catch (e) { console.warn("gather source failed", s.id, e); }
    }
    if (onProgress) onProgress({ done: true });
    if (all.length) window.Store.addGatherItems(all);
    return all;
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
