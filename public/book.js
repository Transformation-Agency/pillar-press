/* ============================================================
   Book helpers — campaign selection/creation for the Book Writer.
   Campaign = book; piece = chapter. Plain JS for testable browser behavior.
   ============================================================ */
(function () {
  const PREF_KEY = "bookCampaignId";

  function resolveBookSelection(campaigns, preferredId) {
    if (!preferredId) return null;
    return (campaigns || []).some((c) => c && c.id === preferredId) ? preferredId : null;
  }

  function pickBookCampaign(id) {
    if (!id) return null;
    window.Store.setPref(PREF_KEY, id);
    window.Store.loadCampaign(id);
    return id;
  }

  function createBookCampaign(name) {
    const clean = String(name || "").trim();
    if (!clean) return null;
    const id = window.Store.addCampaign(clean, { activate: false });
    window.Store.loadCampaign(id);
    window.Store.setPref(PREF_KEY, id);
    return id;
  }

  function promptForBookCampaign(promptFn) {
    const ask = promptFn || window.prompt;
    if (typeof ask !== "function") return null;
    return createBookCampaign(ask("Name your book"));
  }

  function createBookChapter(bookId, bookCampaign, title, chapterCount) {
    if (!bookId) return null;
    const clean = String(title || "").trim() || ("Chapter " + (Number(chapterCount || 0) + 1));
    return window.Store.createPiece(clean, bookId, {
      category: "book",
      categoryContext: {
        bookId,
        bookTitle: bookCampaign && bookCampaign.name,
        chapterRole: "Draft chapter",
      },
    });
  }

  function chapterEditorState(piece) {
    return {
      title: piece ? (piece.title || "") : "",
      draft: piece ? (piece.original || "") : "",
    };
  }

  function chapterPatch(piece, title, draft) {
    if (!piece) return null;
    return {
      title: String(title || "").trim() || piece.title,
      original: typeof draft === "string" ? draft : "",
    };
  }

  function isChapterDirty(piece, title, draft) {
    if (!piece) return false;
    return title !== piece.title || draft !== (piece.original || "");
  }

  function saveChapterDraft(pieceId, patch) {
    if (!pieceId || !patch) return null;
    window.Store.updatePiece(pieceId, patch);
    return patch;
  }

  function mergeUploadedDraft(currentDraft, uploadedText) {
    const incoming = String(uploadedText || "");
    const current = String(currentDraft || "");
    return current.trim() ? current.trimEnd() + "\n\n" + incoming : incoming;
  }

  window.BOOK = {
    PREF_KEY,
    resolveBookSelection,
    pickBookCampaign,
    createBookCampaign,
    promptForBookCampaign,
    createBookChapter,
    chapterEditorState,
    chapterPatch,
    isChapterDirty,
    saveChapterDraft,
    mergeUploadedDraft,
  };
})();
