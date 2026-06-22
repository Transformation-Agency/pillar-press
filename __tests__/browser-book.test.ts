import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function loadBrowserBook(store: Record<string, unknown>, prompt?: unknown) {
  const source = readFileSync(new URL("../public/book.js", import.meta.url), "utf8");
  const window = { Store: store, prompt } as Record<string, unknown>;
  runInNewContext(source, { window });
  return window.BOOK as any;
}

describe("browser Book campaign helpers", () => {
  it("keeps only an existing preferred book campaign selected", () => {
    const book = loadBrowserBook({});

    expect(book.resolveBookSelection([
      { id: "campaign_1", name: "One" },
      { id: "campaign_2", name: "Two" },
    ], "campaign_2")).toBe("campaign_2");
    expect(book.resolveBookSelection([{ id: "campaign_1", name: "One" }], "missing")).toBeNull();
    expect(book.resolveBookSelection([{ id: "campaign_1", name: "One" }], null)).toBeNull();
  });

  it("creates a book campaign without activating it and remembers the Book preference", () => {
    const calls: Array<{ name: string; opts: unknown }> = [];
    const loaded: string[] = [];
    const prefs: Array<[string, string]> = [];
    const book = loadBrowserBook({
      addCampaign: vi.fn((name: string, opts: unknown) => {
        calls.push({ name, opts });
        return "book_campaign_1";
      }),
      loadCampaign: vi.fn((id: string) => loaded.push(id)),
      setPref: vi.fn((key: string, value: string) => prefs.push([key, value])),
    });

    expect(book.createBookCampaign("  The Local Book  ")).toBe("book_campaign_1");
    expect(calls).toEqual([{ name: "The Local Book", opts: { activate: false } }]);
    expect(loaded).toEqual(["book_campaign_1"]);
    expect(prefs).toEqual([["bookCampaignId", "book_campaign_1"]]);
  });

  it("prompts for a book name and ignores blank names", () => {
    const addCampaign = vi.fn();
    const book = loadBrowserBook({
      addCampaign,
      loadCampaign: vi.fn(),
      setPref: vi.fn(),
    });

    expect(book.promptForBookCampaign(() => "   ")).toBeNull();
    expect(addCampaign).not.toHaveBeenCalled();

    addCampaign.mockReturnValueOnce("book_campaign_2");
    expect(book.promptForBookCampaign(() => "Draft Book")).toBe("book_campaign_2");
    expect(addCampaign).toHaveBeenCalledWith("Draft Book", { activate: false });
  });

  it("creates chapters inside the selected book campaign with book category context", () => {
    const created: Array<{ title: string; campaignId: string; opts: unknown }> = [];
    const book = loadBrowserBook({
      createPiece: vi.fn((title: string, campaignId: string, opts: unknown) => {
        created.push({ title, campaignId, opts });
        return { id: "chapter_1", title, campaignId, ...(opts as object) };
      }),
    });

    const chapter = book.createBookChapter(
      "book_campaign_1",
      { id: "book_campaign_1", name: "The Local Book" },
      "",
      2,
    );

    expect(chapter).toMatchObject({ id: "chapter_1", title: "Chapter 3", campaignId: "book_campaign_1" });
    expect(created).toEqual([{
      title: "Chapter 3",
      campaignId: "book_campaign_1",
      opts: {
        category: "book",
        categoryContext: {
          bookId: "book_campaign_1",
          bookTitle: "The Local Book",
          chapterRole: "Draft chapter",
        },
      },
    }]);
  });
});
