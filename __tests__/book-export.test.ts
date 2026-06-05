import { describe, expect, it } from "vitest";
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
