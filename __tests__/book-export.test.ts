import { describe, expect, it, vi } from "vitest";
import {
  bookMarkdown,
  chapterLeadingNumber,
  chapterText,
  sortChaptersForBook,
  type BookChapter,
} from "@/lib/exporters";

/**
 * Pure-helper tests for the Book Writer export (campaign = book, piece =
 * chapter). The route itself is a thin auth+db wrapper around these; its
 * 401/404 behavior comes from the same requireUser/resolveCampaign pattern as
 * every other campaign route.
 */

describe("chapterLeadingNumber", () => {
  it("parses common numbering schemes", () => {
    expect(chapterLeadingNumber("01 Introduction")).toBe(1);
    expect(chapterLeadingNumber("Chapter 1")).toBe(1);
    expect(chapterLeadingNumber("Chapter 12: The Turn")).toBe(12);
    expect(chapterLeadingNumber("Ch. 3 — Aftermath")).toBe(3);
    expect(chapterLeadingNumber("Part 2")).toBe(2);
    expect(chapterLeadingNumber("7. Closing")).toBe(7);
  });
  it("returns null when there is no leading number", () => {
    expect(chapterLeadingNumber("Introduction")).toBeNull();
    expect(chapterLeadingNumber("")).toBeNull();
    expect(chapterLeadingNumber("A Tale of 2 Cities")).toBeNull();
  });
});

describe("chapterText", () => {
  it("uses the saved draft when present", () => {
    expect(chapterText({ title: "x", original: "draft body", revision: { text: "rev body" } })).toBe(
      "draft body",
    );
  });
  it("falls back to revision text only when the draft is empty", () => {
    expect(chapterText({ title: "x", original: "   ", revision: { text: "rev body" } })).toBe(
      "rev body",
    );
    expect(chapterText({ title: "x", original: "", revision: null })).toBe("");
  });
});

describe("sortChaptersForBook", () => {
  it("orders numbered chapters numerically, then unnumbered by incoming order", () => {
    const input: BookChapter[] = [
      { title: "Chapter 2 Two" },
      { title: "Afterword" },
      { title: "10 Ten" },
      { title: "Chapter 1 One" },
      { title: "Preface" },
    ];
    expect(sortChaptersForBook(input).map((c) => c.title)).toEqual([
      "Chapter 1 One",
      "Chapter 2 Two",
      "10 Ten",
      "Afterword",
      "Preface",
    ]);
  });
});

describe("bookMarkdown", () => {
  it("assembles the manuscript with title, ## chapter headings, and --- separators", () => {
    const md = bookMarkdown({
      title: "My Book",
      chapters: [
        { title: "Chapter 1", original: "First chapter text." },
        { title: "Chapter 2", original: "Second chapter text." },
      ],
    });
    expect(md).toBe(
      [
        "# My Book",
        "",
        "## Chapter 1",
        "",
        "First chapter text.",
        "",
        "",
        "---",
        "",
        "## Chapter 2",
        "",
        "Second chapter text.",
        "",
      ].join("\n"),
    );
    expect(md.startsWith("# My Book")).toBe(true);
    expect(md).toContain("## Chapter 1");
    expect(md).toContain("## Chapter 2");
  });
  it("exports the revision text when the draft is empty, and never emits a leading separator", () => {
    const md = bookMarkdown({
      title: "B",
      chapters: [{ title: "Only", original: "", revision: { text: "from revision" } }],
    });
    expect(md).toBe(["# B", "", "## Only", "", "from revision", ""].join("\n"));
  });
});

describe("book export route", () => {
  it("assembles a local-first campaign into ordered book markdown without hosted export gating", async () => {
    vi.resetModules();
    const requireExportEnabled = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local-owner", workspaceId: "local-workspace", role: "author" })),
      getOrCreateWorkspace: vi.fn(),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireExportEnabled }));
    vi.doMock("@/lib/local/database", () => ({
      getLocalCampaign: vi.fn(() => ({ id: "book_1", name: "Local Book" })),
      listLocalPieces: vi.fn(() => [
        { title: "Chapter 2: Later", original: "Second.", revision: null, createdAt: "2026-01-02T00:00:00.000Z" },
        { title: "Chapter 1: First", original: "", revision: { text: "First fallback." }, createdAt: "2026-01-01T00:00:00.000Z" },
      ]),
    }));

    const { GET } = await import("../app/api/campaigns/[id]/book/export/route");
    const res = await GET(new Request("http://test.local/api/campaigns/book_1/book/export"), {
      params: Promise.resolve({ id: "book_1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireExportEnabled).not.toHaveBeenCalled();
    expect(body).toEqual({
      campaignId: "book_1",
      title: "Local Book",
      markdown: [
        "# Local Book",
        "",
        "## Chapter 1: First",
        "",
        "First fallback.",
        "",
        "",
        "---",
        "",
        "## Chapter 2: Later",
        "",
        "Second.",
        "",
      ].join("\n"),
    });
  });
});
