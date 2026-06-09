/* ============================================================
   Gather — research ingestion surface.

   Connectors (RSS, web search, database scrape, journal library,
   X trending, YouTube transcripts) all run through server routes so
   keys, provider configuration, and CORS stay server-side.
   Plain JS. Exposes window.GATHER.
   ============================================================ */
(function () {

  const SOURCE_KINDS = {
    rss:      { id: "rss",      label: "RSS / News feed", icon: "rss",   field: "url",   placeholder: "https://www.example-news.com/feed.xml", hint: "A news or blog RSS feed.", noun: "feed" },
    web:      { id: "web",      label: "Web search",      icon: "globe", field: "query", placeholder: "search terms…",                          hint: "A web search query.", noun: "query" },
    database: { id: "database", label: "Database scrape", icon: "db",    field: "query", placeholder: "site or dataset + what to pull",          hint: "A database / site to query.", noun: "query" },
    journal:  { id: "journal",  label: "Journal library", icon: "book",  field: "query", placeholder: "topic, author, or DOI",                   hint: "Verified academic libraries (Crossref / PubMed / arXiv).", noun: "query" },
    x:        { id: "x",        label: "X trending",      icon: "xLogo", field: "query", placeholder: "#topic or @handle",                       hint: "A trending topic or handle on X.", noun: "topic" },
    youtube:  { id: "youtube",  label: "YouTube transcript", icon: "film", field: "url", placeholder: "https://youtube.com/watch?v=…",          hint: "A video to transcribe.", noun: "video" },
    // Not a connector you add — used to render uploaded-document items.
    upload:   { id: "upload",   label: "Uploaded file",   icon: "doc",   field: "file",  placeholder: "",                                       hint: "An uploaded document.", noun: "file" },
  };

  // Connectors offered in the "add source" picker (upload is excluded — it's an item kind).
  const ORDER = ["rss", "web", "journal", "database", "x", "youtube"];

  function kindList() { return ORDER.map((k) => SOURCE_KINDS[k]); }

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

  const SCHEDULE_KEY = "kingspress.gatherSchedules.v1";
  let schedulerStarted = false;

  function uid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return "sched-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function readSchedules() {
    try {
      const raw = window.localStorage.getItem(SCHEDULE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeSchedules(schedules) {
    window.localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedules));
  }

  function listSchedules(campaignId) {
    return readSchedules().filter((s) => s.campaignId === campaignId);
  }

  function normalizeSchedule(s) {
    if (!s) return s;
    return Object.assign({}, s, {
      time: s.time || s.timeOfDay || "08:00",
      timeOfDay: s.timeOfDay || s.time || null,
      dayOfWeek: s.dayOfWeek == null ? null : Number(s.dayOfWeek),
      enabled: s.enabled !== false,
    });
  }

  async function syncSchedules(campaignId) {
    try {
      const res = await apiGet("/gather/schedules?campaignId=" + encodeURIComponent(campaignId));
      const remote = ((res && res.schedules) || []).map(normalizeSchedule);
      const others = readSchedules().filter((s) => s.campaignId !== campaignId);
      writeSchedules(others.concat(remote));
      return remote;
    } catch (e) {
      return listSchedules(campaignId).map(normalizeSchedule);
    }
  }

  function saveSchedule(input) {
    const schedules = readSchedules();
    const now = Date.now();
    const next = normalizeSchedule(Object.assign({
      id: uid(),
      enabled: true,
      createdAt: now,
      lastRunAt: null,
      lastStatus: null,
    }, input, { timeOfDay: input.timeOfDay || input.time || null, updatedAt: now }));
    const idx = schedules.findIndex((s) => s.id === next.id);
    if (idx >= 0) schedules[idx] = Object.assign({}, schedules[idx], next);
    else schedules.push(next);
    writeSchedules(schedules);
    apiPost("/gather/schedules", {
      id: next.id,
      campaignId: next.campaignId,
      cadence: next.cadence,
      runAt: next.runAt || null,
      timeOfDay: next.timeOfDay || next.time || null,
      dayOfWeek: next.dayOfWeek == null ? null : Number(next.dayOfWeek),
      enabled: next.enabled !== false,
    }).catch(() => {});
    return next;
  }

  function deleteSchedule(id) {
    writeSchedules(readSchedules().filter((s) => s.id !== id));
    fetch("/api/gather/schedules?id=" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { Accept: "application/json" },
    }).catch(() => {});
  }

  function parseTimeToday(time) {
    const m = String(time || "").match(/^(\d{2}):(\d{2})$/);
    const d = new Date();
    if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d;
  }

  function sameLocalDay(a, b) {
    if (!a || !b) return false;
    const da = new Date(a), db = new Date(b);
    return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
  }

  function isDue(s, now = new Date()) {
    if (!s.enabled) return false;
    if (s.cadence === "once") {
      return s.runAt && new Date(s.runAt).getTime() <= now.getTime() && !s.lastRunAt;
    }
    if (s.cadence === "daily") {
      return parseTimeToday(s.time).getTime() <= now.getTime() && !sameLocalDay(s.lastRunAt, now);
    }
    if (s.cadence === "weekly") {
      const day = Number(s.dayOfWeek);
      return now.getDay() === day && parseTimeToday(s.time).getTime() <= now.getTime() && !sameLocalDay(s.lastRunAt, now);
    }
    return false;
  }

  async function runScheduledGather(s) {
    const schedules = readSchedules();
    const idx = schedules.findIndex((x) => x.id === s.id);
    try {
      await apiPost("/gather/run", { campaignId: s.campaignId });
      if (idx >= 0) {
        schedules[idx] = Object.assign({}, schedules[idx], {
          enabled: s.cadence === "once" ? false : schedules[idx].enabled,
          lastRunAt: new Date().toISOString(),
          lastStatus: "ok",
          updatedAt: Date.now(),
        });
      }
    } catch (e) {
      if (idx >= 0) {
        schedules[idx] = Object.assign({}, schedules[idx], {
          lastRunAt: new Date().toISOString(),
          lastStatus: (e && e.message) || "failed",
          updatedAt: Date.now(),
        });
      }
    }
    writeSchedules(schedules);
  }

  function startScheduler() {
    if (window.KINGS_DESKTOP && window.KINGS_DESKTOP.isDesktop && window.KINGS_DESKTOP.isDesktop()) return;
    if (schedulerStarted) return;
    schedulerStarted = true;
    const tick = () => readSchedules().map(normalizeSchedule).filter((s) => isDue(s)).forEach((s) => runScheduledGather(s));
    setTimeout(tick, 1500);
    setInterval(tick, 60000);
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

    // Refresh from server truth (the FULL list — fetched results, prior items,
    // and uploaded documents) so nothing drops out of the view after a run.
    let items;
    try {
      const itemRes = await apiGet("/gather/items?campaignId=" + encodeURIComponent(campaignId));
      items = (itemRes && itemRes.items) || [];
    } catch (e) {
      items = (runRes && runRes.items) || [];
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

  window.GATHER = { SOURCE_KINDS, kindList, runGather, itemToText, listSchedules, syncSchedules, saveSchedule, deleteSchedule, startScheduler };
})();
