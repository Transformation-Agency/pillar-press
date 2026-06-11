/* ============================================================
   Store — pieces, references, settings, media, gather, weave.
   REST-backed (same-origin /api). In-memory cache + pub/sub.
   Synchronous getters; optimistic mutations with background persist.
   Exposes window.Store (and window.Store.ready, a hydration Promise).
   ============================================================ */
(function () {
  const listeners = new Set();

  function uid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return "id-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function now() { return Date.now(); }

  /* ---- minimal REST helpers (same-origin, no auth headers) ---- */
  async function apiGet(path) {
    const r = await fetch("/api" + path, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("GET " + path + " -> " + r.status);
    return r.json();
  }
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
  // fire-and-forget background persist
  function bg(promise, label) {
    Promise.resolve(promise).catch((e) => console.warn("[Store] " + (label || "persist") + " failed:", e && e.message ? e.message : e));
  }

  /* ---- minimal default state so getters never crash before hydrate ---- */
  const STATUSES = ["Draft", "Reviewed", "Revised", "Approved", "Formatted"];

  let state = {
    campaigns: [],
    activeCampaignId: null,
    settings: {
      drive: { clientId: "", folderId: "", folderName: "" },
      hedra: {},
      eleven: {},
    },
    media: [],
    gatherSources: [],
    gatherItems: [],
    gatherSummaries: [], // per-source research briefs from the last run (cache-only)
    pieces: [],
    activePieceId: null,
    theme: "light",
    role: "author",
    weave: { sources: [], result: null },
    desk: { threads: [], activeId: null },
  };

  // tracks which campaigns have had their per-campaign data hydrated
  const loadedCampaigns = new Set();
  const pendingCampaignCreates = new Map();

  function emit() { listeners.forEach((l) => l(state)); }

  /* ---- normalization helpers ---- */
  function normSettings(raw) {
    const s = raw || {};
    const prefs = s.prefs || {};
    state.settings = {
      drive: {
        clientId: (s.drive && s.drive.clientId) || prefs.driveClientId || "",
        folderId: s.driveFolderId || (s.drive && s.drive.folderId) || prefs.driveFolderId || "",
        folderName: (s.drive && s.drive.folderName) || prefs.driveFolderName || "",
      },
      // Media provider keys are server-side/native-side only.
      hedra: {},
      eleven: {},
      prefs: prefs,
    };
    if (prefs.theme === "light" || prefs.theme === "dark") state.theme = prefs.theme;
    if (prefs.role === "author" || prefs.role === "assistant") state.role = prefs.role;
  }

  function ensureCampaign(id) {
    return (state.campaigns || []).find((c) => c.id === id) || null;
  }

  function replaceCampaignId(tempId, realId) {
    if (!tempId || !realId || tempId === realId) return;
    const c = ensureCampaign(tempId);
    if (!c) return;
    c.id = realId;
    if (state.activeCampaignId === tempId) state.activeCampaignId = realId;
    if (state.settings && state.settings.prefs && state.settings.prefs.activeCampaignId === tempId) {
      state.settings.prefs.activeCampaignId = realId;
    }
    (state.pieces || []).forEach((p) => { if (p.campaignId === tempId) p.campaignId = realId; });
    (state.gatherSources || []).forEach((s) => { if (s.campaignId === tempId) s.campaignId = realId; });
    (state.gatherItems || []).forEach((i) => { if (i.campaignId === tempId) i.campaignId = realId; });
    (state.gatherSummaries || []).forEach((s) => { if (s.campaignId === tempId) s.campaignId = realId; });
    (state.media || []).forEach((m) => { if (m.campaignId === tempId) m.campaignId = realId; });
    if (loadedCampaigns.has(tempId)) {
      loadedCampaigns.delete(tempId);
      loadedCampaigns.add(realId);
    }
  }

  function replacePieceId(tempId, realId) {
    if (!tempId || !realId || tempId === realId) return;
    const p = (state.pieces || []).find((x) => x.id === tempId);
    if (!p) return;
    p.id = realId;
    if (state.activePieceId === tempId) state.activePieceId = realId;
    (state.media || []).forEach((m) => { if (m.pieceId === tempId) m.pieceId = realId; });
  }

  /* ---- per-campaign hydration (references + pieces + gather + media) ---- */
  async function hydrateCampaign(id) {
    if (!id || loadedCampaigns.has(id)) return;
    loadedCampaigns.add(id);
    const c = ensureCampaign(id);
    if (!c) { loadedCampaigns.delete(id); return; }
    try {
      const results = await Promise.all([
        apiGet("/campaigns/" + id + "/references").catch(() => ({})),
        apiGet("/campaigns/" + id + "/pieces").catch(() => ({ pieces: [] })),
        apiGet("/gather/sources?campaignId=" + encodeURIComponent(id)).catch(() => ({ sources: [] })),
        apiGet("/gather/items?campaignId=" + encodeURIComponent(id)).catch(() => ({ items: [] })),
        // media has no documented campaignId filter; fetch all and filter client-side.
        apiGet("/media").catch(() => ({})),
      ]);
      const [refDoc, pieceRes, srcRes, itemRes, mediaRes] = results;

      const cc = ensureCampaign(id);
      if (cc) {
        // GET /campaigns/:id/references -> { references: { id, campaignId, doc } }.
        // The actual document is the `doc` field of that row.
        const row = refDoc && refDoc.references;
        cc.references = (row && row.doc) || (refDoc && refDoc.doc) || {};
      }

      const pieces = (pieceRes && pieceRes.pieces) || [];
      // replace this campaign's pieces with server truth, keep other campaigns' cache
      state.pieces = (state.pieces || []).filter((p) => p.campaignId !== id).concat(pieces.map(normPiece));

      const sources = (srcRes && srcRes.sources) || [];
      state.gatherSources = (state.gatherSources || []).filter((s) => s.campaignId !== id).concat(sources);

      // Rebuild this campaign's research briefs from the persisted source rows.
      const hydratedSummaries = sources
        .filter((s) => s.summary)
        .map((s) => ({
          id: uid(), campaignId: id, sourceId: s.id, kind: s.kind,
          label: s.label || null, query: s.config || "",
          itemCount: s.summaryItemCount || 0, text: s.summary,
          at: s.summaryAt ? new Date(s.summaryAt).getTime() : now(),
        }));
      state.gatherSummaries = (state.gatherSummaries || []).filter((s) => s.campaignId !== id).concat(hydratedSummaries);

      const items = (itemRes && itemRes.items) || [];
      state.gatherItems = (state.gatherItems || []).filter((i) => i.campaignId !== id).concat(items);

      const media = mediaArrayFrom(mediaRes);
      if (media) {
        const mine = media.filter((m) => m.campaignId === id).map(normMedia);
        state.media = (state.media || []).filter((m) => m.campaignId !== id).concat(mine);
      }
    } catch (e) {
      console.warn("[Store] hydrateCampaign failed:", e && e.message);
    }
    emit();
  }

  function mediaArrayFrom(res) {
    if (!res) return null;
    if (Array.isArray(res)) return res;
    if (Array.isArray(res.media)) return res.media;
    if (Array.isArray(res.items)) return res.items;
    return null;
  }

  // Server media rows carry `type` (image/video/avatar_video/audio); the UI uses
  // `kind`. Map it so hydrated media filter/preview correctly (fresh client media
  // already set `kind`).
  function normMedia(m) {
    const kind = m.kind || ({ image: "image", audio: "audio", avatar_video: "avatar", avatar: "avatar", video: "video" }[m.type] || "video");
    return Object.assign({ kind }, m, { kind });
  }

  function normPiece(p) {
    return Object.assign({
      campaignId: state.activeCampaignId, status: "Draft",
      original: "", packet: null, revision: null, outputs: {}, outputOrder: [],
      createdAt: now(), updatedAt: now(),
    }, p);
  }

  /* ---- top-level hydration ---- */
  async function hydrate() {
    try {
      if (window.KP_AUTH && window.KP_AUTH.ready) {
        await window.KP_AUTH.ready.catch(() => null);
        const auth = window.KP_AUTH.snapshot ? window.KP_AUTH.snapshot() : null;
        if (auth && auth.requiresLogin && !auth.authenticated) {
          emit();
          return;
        }
      }
      const [campRes, setRes] = await Promise.all([
        apiGet("/campaigns").catch(() => ({ campaigns: [] })),
        apiGet("/settings").catch(() => ({ settings: {} })),
      ]);

      const camps = (campRes && campRes.campaigns) || [];
      state.campaigns = camps.map((c) => ({ id: c.id, name: c.name, slug: c.slug, references: null }));

      normSettings((setRes && setRes.settings) || setRes || {});

      // pick active: persisted pref, else first campaign
      const prefActive = state.settings && state.settings.prefs && state.settings.prefs.activeCampaignId;
      let activeId = (prefActive && ensureCampaign(prefActive)) ? prefActive : (state.campaigns[0] ? state.campaigns[0].id : null);
      state.activeCampaignId = activeId;

      document.documentElement.setAttribute("data-theme", state.theme || "light");
      emit(); // render shell with campaign list + settings

      if (activeId) await hydrateCampaign(activeId);
      const deskRes = await apiGet("/desk/session").catch(() => ({ session: { state: {} } }));
      const deskState = deskRes && deskRes.session && deskRes.session.state;
      if (deskState && typeof deskState === "object") {
        state.desk = Object.assign({ threads: [], activeId: null }, deskState);
      }
    } catch (e) {
      console.warn("[Store] hydrate failed:", e && e.message);
    }
    document.documentElement.setAttribute("data-theme", state.theme || "light");
    emit();
  }

  /* ---- persist theme/role into settings.prefs (best-effort) ---- */
  function persistPrefs(extra) {
    const prefs = Object.assign({}, (state.settings && state.settings.prefs) || {}, {
      theme: state.theme, role: state.role, activeCampaignId: state.activeCampaignId,
    }, extra || {});
    if (!state.settings) state.settings = {};
    state.settings.prefs = prefs;
    bg(apiSend("PUT", "/settings", { prefs }), "PUT /settings");
  }

  const api = {
    STATUSES,
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reload() { loadedCampaigns.clear(); return hydrate(); },

    setTheme(t) { state.theme = t; document.documentElement.setAttribute("data-theme", t); emit(); persistPrefs(); },
    toggleTheme() { api.setTheme(state.theme === "dark" ? "light" : "dark"); },

    setRole(r) { state.role = r; emit(); persistPrefs(); },

    /* ---- Generic UI prefs (persisted to settings.prefs) ---- */
    getPref(key, fallback) { const p = state.settings && state.settings.prefs; return (p && p[key] != null) ? p[key] : fallback; },
    setPref(key, value) {
      if (!state.settings) state.settings = {};
      state.settings.prefs = Object.assign({}, state.settings.prefs || {}, { [key]: value });
      emit(); persistPrefs({ [key]: value });
    },
    setPrefs(patch) {
      if (!patch || typeof patch !== "object") return;
      if (!state.settings) state.settings = {};
      state.settings.prefs = Object.assign({}, state.settings.prefs || {}, patch);
      emit(); persistPrefs(patch);
    },

    /* ---- Desk chat session (thread state, persisted as one scoped blob) ---- */
    getDesk() {
      if (!state.desk) state.desk = { threads: [], activeId: null };
      if (!Array.isArray(state.desk.threads)) state.desk.threads = [];
      return state.desk;
    },
    setDesk(next) {
      state.desk = Object.assign({ threads: [], activeId: null }, next || {});
      emit();
      bg(apiSend("PUT", "/desk/session", {
        activeId: state.desk.activeId || null,
        state: state.desk,
      }), "PUT /desk/session");
      return state.desk;
    },

    /* ---- Campaigns ---- */
    getCampaigns() { return state.campaigns || []; },
    getCampaign(id) { return (state.campaigns || []).find((c) => c.id === id) || null; },
    activeCampaign() { return api.getCampaign(state.activeCampaignId) || (state.campaigns || [])[0]; },
    activeReferences() {
      const c = api.activeCampaign();
      // Default skeleton so screens (which read e.g. strategy.throughlines) never
      // crash during the brief window before a campaign's references hydrate.
      const SAFE = { strategy: { throughlines: [], body: "" }, audiences: { list: [] }, registers: { list: [], body: "" }, voiceRules: { rules: [] }, redLines: { rules: [] }, selfVision: { body: "" }, gateSpec: { body: "" } };
      return Object.assign({}, SAFE, (c && c.references) || {});
    },
    setActiveCampaign(id) {
      if (!api.getCampaign(id)) return;
      state.activeCampaignId = id;
      state.activePieceId = null;
      emit();
      persistPrefs();
      if (!loadedCampaigns.has(id)) bg(hydrateCampaign(id), "hydrateCampaign");
    },
    // opts.activate (default true): make the new campaign the globally-active
    // one. The Book Writer creates book campaigns with { activate:false } so a
    // new book never hijacks the active article campaign ("Me").
    addCampaign(name, opts) {
      const activate = !opts || opts.activate !== false;
      const id = uid();
      state.campaigns.push({ id, name: name || "New campaign", references: {} });
      loadedCampaigns.add(id); // brand-new, nothing to fetch
      if (activate) { state.activeCampaignId = id; state.activePieceId = null; }
      emit();
      const created = apiSend("POST", "/campaigns", { name: name || "New campaign" }).then((res) => {
        const serverCampaign = res && res.campaign;
        if (!serverCampaign || !serverCampaign.id) return ensureCampaign(id);
        replaceCampaignId(id, serverCampaign.id);
        const c = ensureCampaign(serverCampaign.id);
        if (c) Object.assign(c, { name: serverCampaign.name || c.name, slug: serverCampaign.slug || c.slug });
        emit();
        persistPrefs();
        return c || ensureCampaign(serverCampaign.id);
      });
      pendingCampaignCreates.set(id, created);
      created.then(() => pendingCampaignCreates.delete(id), () => pendingCampaignCreates.delete(id));
      bg(created, "POST /campaigns");
      persistPrefs();
      return id;
    },
    whenCampaignSaved(id) {
      return pendingCampaignCreates.get(id) || Promise.resolve(api.getCampaign(id));
    },
    // Hydrate a campaign's references + pieces (+ gather/media) on demand WITHOUT
    // making it the active campaign — used by the Book Writer to load a book
    // campaign that differs from the globally-active one. Self-guards on the
    // loadedCampaigns set, so repeated calls are cheap.
    loadCampaign(id) { if (id) bg(hydrateCampaign(id), "loadCampaign"); },
    renameCampaign(id, name) {
      const c = api.getCampaign(id);
      if (!c) return;
      c.name = name;
      emit();
      bg(apiSend("PATCH", "/campaigns/" + id, { name }), "PATCH /campaigns/:id");
    },

    /* ---- Settings (Drive / Hedra / ElevenLabs) ---- */
    getSettings() {
      if (!state.settings) state.settings = {};
      const s = state.settings;
      s.drive = s.drive || { clientId: "", folderId: "", folderName: "" };
      s.hedra = s.hedra || {};
      s.eleven = s.eleven || {};
      return s;
    },
    setDriveConfig(patch) {
      const s = api.getSettings();
      s.drive = Object.assign({}, s.drive, patch);
      emit();
      // only driveFolderId + prefs are server-persisted
      const body = {};
      if (typeof s.drive.folderId === "string") body.driveFolderId = s.drive.folderId;
      body.prefs = Object.assign({}, (state.settings && state.settings.prefs) || {}, {
        driveClientId: s.drive.clientId, driveFolderName: s.drive.folderName,
      });
      state.settings.prefs = body.prefs;
      bg(apiSend("PUT", "/settings", body), "PUT /settings (drive)");
    },
    /* ---- Media assets (Studio) ---- */
    getMedia() { if (!Array.isArray(state.media)) state.media = []; return state.media; },
    mediaForCampaign(cid) { return api.getMedia().filter((m) => m.campaignId === cid); },
    mediaForPiece(pid) { return api.getMedia().filter((m) => m.pieceId === pid); },
    addMedia(obj) {
      // real media row is created by /api/hedra/generate (Studio unit); stay cache-first.
      const m = Object.assign({ id: uid(), campaignId: state.activeCampaignId, createdAt: now(), updatedAt: now() }, obj);
      api.getMedia().unshift(m);
      emit();
      return m;
    },
    updateMedia(id, patch) {
      const m = api.getMedia().find((x) => x.id === id);
      if (m) {
        Object.assign(m, patch, { updatedAt: now() });
        emit();
        bg(apiSend("PATCH", "/media/" + id, patch), "PATCH /media/:id");
      }
      return m;
    },
    removeMedia(id) {
      state.media = api.getMedia().filter((x) => x.id !== id);
      emit();
      bg(apiSend("DELETE", "/media?id=" + encodeURIComponent(id)), "DELETE /media");
    },
    attachMediaToPiece(id, pieceId) {
      const m = api.getMedia().find((x) => x.id === id);
      if (m) { m.pieceId = pieceId; m.updatedAt = now(); emit(); }
      bg(apiSend("PATCH", "/media/" + id, { pieceId }), "PATCH /media/:id (attach)");
      return m;
    },

    /* ---- Gather (research ingestion) ---- */
    getGatherSources(cid) { if (!Array.isArray(state.gatherSources)) state.gatherSources = []; return state.gatherSources.filter((s) => s.campaignId === cid); },
    addGatherSource(obj) {
      if (!Array.isArray(state.gatherSources)) state.gatherSources = [];
      const id = uid();
      const s = Object.assign({ id, campaignId: state.activeCampaignId, enabled: true, createdAt: now() }, obj);
      state.gatherSources.unshift(s);
      emit();
      bg(apiSend("POST", "/gather/sources", {
        id, campaignId: s.campaignId, kind: s.kind, config: s.config, label: s.label, enabled: s.enabled,
      }), "POST /gather/sources");
      return s;
    },
    updateGatherSource(id, patch) {
      const s = state.gatherSources.find((x) => x.id === id);
      if (s) { Object.assign(s, patch); emit(); bg(apiSend("PATCH", "/gather/sources/" + id, patch), "PATCH /gather/sources/:id"); }
      return s;
    },
    removeGatherSource(id) {
      state.gatherSources = state.gatherSources.filter((x) => x.id !== id);
      emit();
      bg(apiSend("DELETE", "/gather/sources/" + id), "DELETE /gather/sources/:id");
    },
    getGatherItems(cid) { if (!Array.isArray(state.gatherItems)) state.gatherItems = []; return state.gatherItems.filter((i) => i.campaignId === cid); },
    addGatherItems(arr) {
      // items are already persisted server-side by the gather run; cache-only here.
      if (!Array.isArray(state.gatherItems)) state.gatherItems = [];
      const made = arr.map((o) => Object.assign({ id: uid(), campaignId: state.activeCampaignId, createdAt: now(), selected: false }, o));
      state.gatherItems.unshift.apply(state.gatherItems, made);
      emit();
      return made;
    },
    updateGatherItem(id, patch) {
      const i = state.gatherItems.find((x) => x.id === id);
      if (i) { Object.assign(i, patch); emit(); }
      return i;
    },
    // Create a gathered item directly (uploaded document) — persisted server-side.
    addUploadedItem(obj) {
      if (!Array.isArray(state.gatherItems)) state.gatherItems = [];
      const id = uid();
      const cid = state.activeCampaignId;
      const it = Object.assign({ id, campaignId: cid, kind: "upload", createdAt: now(), selected: false }, obj);
      state.gatherItems.unshift(it);
      emit();
      bg(apiSend("POST", "/gather/items", {
        id, campaignId: cid, kind: it.kind, title: it.title,
        source: it.source, author: it.author || null, url: it.url || null,
        snippet: it.snippet, transcript: it.transcript || null,
      }), "POST /gather/items");
      return it;
    },
    removeGatherItem(id) {
      state.gatherItems = state.gatherItems.filter((x) => x.id !== id);
      emit();
      bg(apiSend("DELETE", "/gather/items?id=" + encodeURIComponent(id)), "DELETE /gather/items");
    },
    clearGatherItems(cid) {
      const toRemove = state.gatherItems.filter((i) => i.campaignId === cid);
      state.gatherItems = state.gatherItems.filter((i) => i.campaignId !== cid);
      emit();
      toRemove.forEach((i) => bg(apiSend("DELETE", "/gather/items?id=" + encodeURIComponent(i.id)), "DELETE /gather/items"));
    },
    // Per-source research briefs (persisted on the source row server-side).
    getGatherSummaries(cid) { if (!Array.isArray(state.gatherSummaries)) state.gatherSummaries = []; return state.gatherSummaries.filter((s) => s.campaignId === cid); },
    // Merge a run's fresh briefs by sourceId, preserving briefs for sources not
    // in this run (server already persisted these on their source rows).
    setGatherSummaries(cid, arr) {
      if (!Array.isArray(state.gatherSummaries)) state.gatherSummaries = [];
      const made = (arr || []).map((o) => Object.assign({ id: uid(), campaignId: cid, at: now() }, o));
      const freshSourceIds = new Set(made.map((s) => s.sourceId));
      state.gatherSummaries = state.gatherSummaries
        .filter((s) => !(s.campaignId === cid && freshSourceIds.has(s.sourceId)))
        .concat(made);
      emit();
      return made;
    },
    removeGatherSummary(id) {
      const s = (state.gatherSummaries || []).find((x) => x.id === id);
      state.gatherSummaries = (state.gatherSummaries || []).filter((x) => x.id !== id);
      emit();
      // Clear the persisted brief on its source row so it doesn't rehydrate.
      if (s && s.sourceId) bg(apiSend("PATCH", "/gather/sources/" + s.sourceId, { summary: null }), "PATCH /gather/sources/:id (clear summary)");
    },

    /* ---- Pieces ---- */
    getPiece(id) { return (state.pieces || []).find((p) => p.id === id) || null; },
    setActive(id) { state.activePieceId = id; emit(); },

    // campaignId (optional) targets a specific campaign — the Book Writer passes
    // the book's campaign so chapters land in the book, not the active campaign.
    createPiece(title, campaignId) {
      const cid = campaignId || state.activeCampaignId;
      const id = uid();
      const p = {
        id, campaignId: cid, title: title || "Untitled piece", status: "Draft",
        createdAt: now(), updatedAt: now(),
        original: "", packet: null, revision: null, outputs: {}, outputOrder: [],
      };
      state.pieces.unshift(p);
      state.activePieceId = p.id;
      emit();
      bg(apiSend("POST", "/campaigns/" + cid + "/pieces", { title: p.title, original: "" }).then((res) => {
        const serverPiece = res && res.piece;
        if (!serverPiece || !serverPiece.id) return;
        replacePieceId(id, serverPiece.id);
        const current = api.getPiece(serverPiece.id);
        if (current) Object.assign(current, normPiece(serverPiece));
        emit();
      }), "POST pieces");
      return p;
    },
    updatePiece(id, patch) {
      const p = api.getPiece(id);
      if (!p) return;
      Object.assign(p, patch, { updatedAt: now() });
      emit();
      const body = {};
      ["title", "original", "status", "packet", "revision", "outputs", "outputOrder"].forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(patch, k)) body[k] = patch[k];
      });
      if (Object.keys(body).length) bg(apiSend("PATCH", "/pieces/" + id, body), "PATCH /pieces/:id");
    },
    deletePiece(id) {
      state.pieces = state.pieces.filter((p) => p.id !== id);
      if (state.activePieceId === id) state.activePieceId = null;
      emit();
      bg(apiSend("DELETE", "/pieces/" + id), "DELETE /pieces/:id");
    },
    setStatus(id, status) { api.updatePiece(id, { status }); },

    /* ---- Weave (multi-file synthesis) — CLIENT-ONLY (ephemeral staging) ---- */
    getWeave() {
      if (!state.weave) state.weave = { sources: [], result: null };
      return state.weave;
    },
    addWeaveSource(name, text) {
      const s = { id: uid(), name: name || "Untitled source", text: text || "" };
      api.getWeave().sources.push(s);
      emit();
      return s;
    },
    updateWeaveSource(id, patch) {
      const w = api.getWeave();
      const s = w.sources.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
      emit();
    },
    removeWeaveSource(id) {
      const w = api.getWeave();
      w.sources = w.sources.filter((x) => x.id !== id);
      emit();
    },
    clearWeave() { state.weave = { sources: [], result: null }; emit(); },
    setWeaveResult(result) { api.getWeave().result = result; emit(); },

    /* ---- References ---- */
    updateReferences(patch) {
      const c = api.activeCampaign();
      if (!c) return Promise.resolve(null);
      c.references = Object.assign({}, c.references, patch);
      emit();
      const saved = apiSend("PUT", "/campaigns/" + c.id + "/references", { patch });
      bg(saved, "PUT references");
      return saved;
    },
    setReferenceSection(key, value) {
      const c = api.activeCampaign();
      if (!c) return;
      if (!c.references) c.references = {};
      c.references[key] = value;
      emit();
      var p = {}; p[key] = value;
      bg(apiSend("PUT", "/campaigns/" + c.id + "/references", { patch: p }), "PUT references (section)");
    },
  };

  // apply theme on load (pre-hydrate default)
  document.documentElement.setAttribute("data-theme", state.theme || "light");

  // expose API, then kick off async hydration
  window.Store = api;
  api.ready = hydrate();
})();
