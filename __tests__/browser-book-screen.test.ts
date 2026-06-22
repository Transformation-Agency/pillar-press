import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const screenSource = () => readFileSync(new URL("../public/screen-book.jsx", import.meta.url), "utf8");

describe("browser Book Writer screen", () => {
  it("exposes book campaign selection and chapter creation as the visible Book workflow", () => {
    const screen = screenSource();

    expect(screen).toContain("Book Writer");
    expect(screen).toContain("Each book is its own campaign");
    expect(screen).toContain("NEW BOOK");
    expect(screen).toContain("Pick a book, or start a new one");
    expect(screen).toContain("A book is its own campaign with its own library of chapters");
    expect(screen).toContain("Write a book, one chapter at a time");
    expect(screen).toContain("Add chapter 1");
    expect(screen).toContain("window.BOOK.promptForBookCampaign()");
    expect(screen).toContain("window.BOOK.createBookChapter(bookId, bookCampaign, t, chapters.length)");
  });

  it("wires chapter editing, status, uploaded draft merge, and full-desk handoff", () => {
    const screen = screenSource();

    expect(screen).toContain("window.BOOK.chapterEditorState(p)");
    expect(screen).toContain("window.BOOK.isChapterDirty(piece, title, draft)");
    expect(screen).toContain("window.BOOK.chapterPatch(p, title, draft)");
    expect(screen).toContain('bookApi("PATCH", "/api/pieces/" + p.id, fields)');
    expect(screen).toContain("const text = await window.extractFileText(f)");
    expect(screen).toContain("window.BOOK.mergeUploadedDraft(draft, text)");
    expect(screen).toContain("window.Store.setStatus(p.id, s)");
    expect(screen).toContain("Desk ↗");
    expect(screen).toContain("onActivateCampaign(bookId)");
    expect(screen).toContain("onOpenPiece(piece.id)");
  });

  it("saves latest chapter text before review, revision, outputs, weave, and export flows", () => {
    const screen = screenSource();

    expect(screen).toContain("await persistChapter();");
    expect(screen).toContain('bookApi("POST", "/api/pieces/" + selectedId + "/review")');
    expect(screen).toContain('fetch("/api/pieces/" + selectedId + "/review/status"');
    expect(screen).toContain("window.GEN.generateRevision(window.Store.getPiece(selectedId), refCtx");
    expect(screen).toContain('fetch("/api/pieces/" + selectedId + "/revision/status"');
    expect(screen).toContain("window.GEN.generateOutputs(window.Store.getPiece(selectedId), active, BOOK_PLAT_AUD, refCtx");
    expect(screen).toContain("window.WEAVE.runWeave(sources, refCtx");
    expect(screen).toContain("window.Store.updatePiece(piece.id, { weave: res, original: res.draft");
    expect(screen).toContain("window.BOOK.acceptRevisionPatch(p)");
  });

  it("uses the server book export route for Markdown download and Drive upload with billing gates", () => {
    const screen = screenSource();

    expect(screen).toContain("bookExportAllowed()");
    expect(screen).toContain("notifyBookExportBlocked()");
    expect(screen).toContain("bookDriveDisabledByPlan()");
    expect(screen).toContain("notifyBookDriveBlocked()");
    expect(screen).toContain('bookApi("GET", "/api/campaigns/" + bookCampaign.id + "/book/export")');
    expect(screen).toContain("window.EXPORT.downloadText(res.markdown || \"\"");
    expect(screen).toContain("window.DRIVE.uploadFile(window.EXPORT.safeName(res.title || bookCampaign.name) + \"-book.md\"");
    expect(screen).toContain("Download book");
    expect(screen).toContain("To Drive");
  });
});
