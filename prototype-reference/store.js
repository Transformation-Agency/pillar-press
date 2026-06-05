/* ============================================================
   Store — pieces, references, persistence, pub/sub.
   Plain JS. Exposes window.Store.
   ============================================================ */
(function () {
  const KEY = "pillarpress.v1";
  const listeners = new Set();

  function uid() { return Math.random().toString(36).slice(2, 9); }
  function now() { return Date.now(); }

  /* ---- Seed reference documents (representative placeholders) ---- */
  const SEED_REFERENCES = {
    strategy: {
      title: "Content Strategy",
      throughlines: [
        { tag: "human-in-the-loop", name: "The Human in the Loop", note: "AI extends human judgment; it does not replace the author. Agency stays with people." },
        { tag: "relational-tech", name: "Relational Technology", note: "Tools are worth building only if they deepen relationships and trust between people." },
        { tag: "quiet-competence", name: "Quiet Competence", note: "Mastery shown, not announced. Show the work; skip the triumphalism." },
        { tag: "coordination", name: "Coordination & Governance", note: "How groups decide, align, and keep promises at scale." },
      ],
      body: "Every piece must serve at least one throughline. If it doesn't, name the nearest strategic angle and the smallest pivot that would land it there. We never recommend killing a piece — only redirecting it."
    },
    audiences: {
      title: "Defined Audiences",
      list: [
        { id: "leaders", name: "Leaders in personal spheres", note: "People who shape a community, team, or family. Care about responsibility and example." },
        { id: "builders", name: "Builders & founders", note: "Shipping things. Want leverage, honesty about tradeoffs, and no hype." },
        { id: "women-ai", name: "Women curious about AI", note: "Smart, skeptical, underserved by hype-cycle coverage. Want a grounded on-ramp." },
        { id: "governance", name: "Governance & coordination thinkers", note: "Mechanism-minded. Care about incentives, institutions, and failure modes." },
        { id: "relational", name: "Existing relational audience", note: "People who already know and trust the author. Speak as a continuing conversation." },
        { id: "general", name: "General public bridge", note: "No prior context. Need the stakes made plain without condescension." },
      ]
    },
    registers: {
      title: "Voice — Two Registers",
      list: [
        { id: "essay", name: "Essay register", note: "Measured, literary, first-person, comfortable with a long sentence and a turn. For Substack and reflective long-form. Earns its claims slowly." },
        { id: "field", name: "Field register", note: "Direct, plain, second-person-friendly, short sentences. For relational platforms and practical posts. Warm, not breezy." },
      ],
      body: "Detect which register a piece is in. Flag register mixing (an essay sentence dropped into a field post, or vice versa) and voice drift (sentences that sound generic-LinkedIn, not like the author)."
    },
    voiceRules: {
      title: "Clarity & Communication Rules",
      rules: [
        "The central claim appears in the first two lines.",
        "Each paragraph does exactly one job.",
        "Actors and actions are visible — name who does what; avoid hidden subjects and nominalizations.",
        "Every term is either defined on first use or cut.",
        "Every number carries its meaning — no naked statistics.",
        "Prefer the concrete noun to the abstract category.",
        "A line that sounds like the author always beats a tidier generic line.",
      ]
    },
    redLines: {
      title: "Red Lines & Boundaries",
      rules: [
        "No claims of certainty about others' internal states or motives.",
        "No dunking, no contempt, no quote-tweet hostility — disagree with the strongest version.",
        "No private details about named real people without consent.",
        "No fear-based AI doom framing as a hook; stakes stated soberly.",
        "No selling in the first beat of a relational post; offerings come last and optional.",
        "Never overclaim empirical results; testimony is fine as testimony.",
      ]
    },
    selfVision: {
      title: "Self-Vision — Public Identity",
      body: "The author is a builder who writes: technically fluent but not a hype-man, warm but exacting, more interested in good questions than hot takes. Optimistic about technology in service of human relationship and judgment. Reads as a person thinking in public, not a brand performing authority. Self-alignment gate flags anything that contradicts this — false bravado, manufactured outrage, borrowed jargon, or certainty the author wouldn't actually claim."
    },
    gateSpec: {
      title: "Gate Specification",
      body: "Seven gates run in order. Each emits a section of the Review Packet. Findings carry one of three severities — Must-fix, Consider, Note — grouped by gate and ordered by severity within each gate. The Proposed Revision applies ONLY clarity, tone, and inoculation findings; strategy, audience, rigor, and identity findings remain in the report for the author to judge. Where a clarity rule would flatten a line that sounds like the author, the author's line wins."
    }
  };

  const SAMPLE_DRAFT = `Most people think AI will replace human judgment. I think that's exactly backwards.

For two years I've watched teams hand their hardest calls to a model and then quietly override it anyway. The interesting question was never "can the machine decide?" It was "what does the machine free the human to attend to?"

When a tool drafts the obvious paragraph, you get to spend your attention on the paragraph only you could write. That is not a smaller job. It is a more human one. The studies show productivity gains of 40% across the board, and everyone agrees this is the biggest shift since the printing press.

I am not optimistic because I think the technology is safe. I am optimistic because I have seen what happens in the room when a person stops doing the work a machine can do, and starts doing the work only they can do. They get braver. They ask the better question. They take the call they were avoiding.

The loop still closes on a human. It should. Keep your hand on it.`;

  const CAMPAIGN_NAMES = ["Me", "Anna", "Diana", "Liana", "Max", "Transformation Agency", "Metacanon AI", "Lumenus Inc", "Jedi Sherpa", "Wizard Joe", "Feral Pharaoh"];
  function slug(n) { return n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function cloneRefs() { return JSON.parse(JSON.stringify(SEED_REFERENCES)); }
  function makeCampaigns() {
    return CAMPAIGN_NAMES.map((n) => ({ id: slug(n), name: n, references: cloneRefs() }));
  }

  const DEFAULT_STATE = {
    campaigns: makeCampaigns(),
    activeCampaignId: "me",
    settings: {
      drive: { clientId: "", folderId: "", folderName: "" },
      hedra: { apiKey: "" },
      eleven: { apiKey: "" },
    },
    media: [],
    pieces: [
      {
        id: "smp1", campaignId: "me", title: "The Loop Still Closes on a Human", status: "Reviewed",
        createdAt: now() - 86400000 * 5, updatedAt: now() - 86400000 * 2,
        original: SAMPLE_DRAFT, packet: null, revision: null, outputs: {}, outputOrder: [],
      },
      {
        id: "smp2", campaignId: "me", title: "Why I Stopped Calling It a Tool", status: "Draft",
        createdAt: now() - 86400000 * 2, updatedAt: now() - 86400000 * 2,
        original: "", packet: null, revision: null, outputs: {}, outputOrder: [],
      },
      {
        id: "smp3", campaignId: "me", title: "Coordination Is the Real Product", status: "Approved",
        createdAt: now() - 86400000 * 12, updatedAt: now() - 86400000 * 6,
        original: "Software doesn't fail because the code is wrong. It fails because two people believed different things about what they agreed to.",
        packet: null, revision: null, outputs: {}, outputOrder: [],
      },
    ],
    activePieceId: null,
    theme: "light",
    role: "author",
    weave: { sources: [], result: null },
  };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // --- migrate older single-References shape to campaigns ---
        if (!parsed.campaigns) {
          const camps = makeCampaigns();
          if (parsed.references) camps[0].references = Object.assign({}, SEED_REFERENCES, parsed.references);
          parsed.campaigns = camps;
          parsed.activeCampaignId = "me";
          delete parsed.references;
        } else {
          // ensure every campaign has all seed reference sections; add any missing named campaigns
          const byId = {};
          parsed.campaigns.forEach((c) => { c.references = Object.assign({}, SEED_REFERENCES, c.references || {}); byId[c.id] = true; });
          CAMPAIGN_NAMES.forEach((n) => { if (!byId[slug(n)]) parsed.campaigns.push({ id: slug(n), name: n, references: cloneRefs() }); });
        }
        if (!parsed.activeCampaignId || !parsed.campaigns.find((c) => c.id === parsed.activeCampaignId)) parsed.activeCampaignId = parsed.campaigns[0].id;
        // tag any untagged pieces to the first campaign
        (parsed.pieces || []).forEach((p) => { if (!p.campaignId) p.campaignId = parsed.campaigns[0].id; });
        if (!parsed.settings) parsed.settings = {};
        if (!parsed.settings.drive) parsed.settings.drive = { clientId: "", folderId: "", folderName: "" };
        if (!parsed.settings.hedra) parsed.settings.hedra = { apiKey: "" };
        if (!parsed.settings.eleven) parsed.settings.eleven = { apiKey: "" };
        if (!Array.isArray(parsed.media)) parsed.media = [];
        return parsed;
      }
    } catch (e) { console.warn("Store load failed", e); }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn("persist failed", e); }
  }

  function emit() { persist(); listeners.forEach((l) => l(state)); }

  const STATUSES = ["Draft", "Reviewed", "Revised", "Approved", "Formatted"];

  const api = {
    STATUSES,
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    setTheme(t) { state.theme = t; document.documentElement.setAttribute("data-theme", t); emit(); },
    toggleTheme() { api.setTheme(state.theme === "dark" ? "light" : "dark"); },

    setRole(r) { state.role = r; emit(); },

    /* ---- Campaigns ---- */
    getCampaigns() { return state.campaigns || []; },
    getCampaign(id) { return (state.campaigns || []).find((c) => c.id === id) || null; },
    activeCampaign() { return api.getCampaign(state.activeCampaignId) || (state.campaigns || [])[0]; },
    activeReferences() { const c = api.activeCampaign(); return c ? c.references : {}; },
    setActiveCampaign(id) { if (api.getCampaign(id)) { state.activeCampaignId = id; state.activePieceId = null; emit(); } },
    addCampaign(name) {
      let base = slug(name || "campaign"); let id = base; let i = 2;
      while (api.getCampaign(id)) { id = base + "-" + i++; }
      state.campaigns.push({ id, name: name || "New campaign", references: cloneRefs() });
      state.activeCampaignId = id;
      emit();
      return id;
    },
    renameCampaign(id, name) { const c = api.getCampaign(id); if (c) { c.name = name; emit(); } },

    /* ---- Settings (Drive / Hedra / ElevenLabs) ---- */
    getSettings() { if (!state.settings) state.settings = {}; const s = state.settings; s.drive = s.drive || { clientId: "", folderId: "", folderName: "" }; s.hedra = s.hedra || { apiKey: "" }; s.eleven = s.eleven || { apiKey: "" }; return s; },
    setDriveConfig(patch) { const s = api.getSettings(); s.drive = Object.assign({}, s.drive, patch); emit(); },
    setHedraConfig(patch) { const s = api.getSettings(); s.hedra = Object.assign({}, s.hedra, patch); emit(); },
    setElevenConfig(patch) { const s = api.getSettings(); s.eleven = Object.assign({}, s.eleven, patch); emit(); },

    /* ---- Media assets (Studio) ---- */
    getMedia() { if (!Array.isArray(state.media)) state.media = []; return state.media; },
    mediaForCampaign(cid) { return api.getMedia().filter((m) => m.campaignId === cid); },
    mediaForPiece(pid) { return api.getMedia().filter((m) => m.pieceId === pid); },
    addMedia(obj) {
      const m = Object.assign({ id: uid(), campaignId: state.activeCampaignId, createdAt: now(), updatedAt: now() }, obj);
      api.getMedia().unshift(m); emit(); return m;
    },
    updateMedia(id, patch) { const m = api.getMedia().find((x) => x.id === id); if (m) { Object.assign(m, patch, { updatedAt: now() }); emit(); } return m; },
    removeMedia(id) { state.media = api.getMedia().filter((x) => x.id !== id); emit(); },
    attachMediaToPiece(id, pieceId) { return api.updateMedia(id, { pieceId }); },

    getPiece(id) { return state.pieces.find((p) => p.id === id) || null; },
    setActive(id) { state.activePieceId = id; emit(); },

    createPiece(title) {
      const p = {
        id: uid(), campaignId: state.activeCampaignId, title: title || "Untitled piece", status: "Draft",
        createdAt: now(), updatedAt: now(),
        original: "", packet: null, revision: null, outputs: {}, outputOrder: [],
      };
      state.pieces.unshift(p);
      state.activePieceId = p.id;
      emit();
      return p;
    },
    updatePiece(id, patch) {
      const p = api.getPiece(id);
      if (!p) return;
      Object.assign(p, patch, { updatedAt: now() });
      emit();
    },
    deletePiece(id) {
      state.pieces = state.pieces.filter((p) => p.id !== id);
      if (state.activePieceId === id) state.activePieceId = null;
      emit();
    },
    setStatus(id, status) { api.updatePiece(id, { status }); },

    /* ---- Weave (multi-file synthesis) ---- */
    getWeave() {
      if (!state.weave) state.weave = { sources: [], result: null };
      return state.weave;
    },
    addWeaveSource(name, text) {
      api.getWeave().sources.push({ id: uid(), name: name || "Untitled source", text: text || "" });
      emit();
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

    updateReferences(patch) {
      const c = api.activeCampaign(); if (!c) return;
      c.references = Object.assign({}, c.references, patch);
      emit();
    },
    setReferenceSection(key, value) {
      const c = api.activeCampaign(); if (!c) return;
      c.references[key] = value;
      emit();
    },
    resetAll() {
      state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      document.documentElement.setAttribute("data-theme", state.theme);
      emit();
    },
  };

  // apply theme on load
  document.documentElement.setAttribute("data-theme", state.theme || "light");

  window.Store = api;
})();
