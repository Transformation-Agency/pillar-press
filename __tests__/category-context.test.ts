import { describe, expect, it } from "vitest";
import { buildCategoryContext, withCategoryPrompt } from "@/lib/editorial/categoryContext";

describe("category context builder", () => {
  it("defaults legacy pieces to article context", () => {
    const ctx = buildCategoryContext({ title: "Draft" });
    expect(ctx.category).toBe("article");
    expect(ctx.label).toBe("Article review");
    expect(ctx.promptBlock).toContain("Article / publication");
  });

  it("builds bounded letter guidance and omits secret-looking keys", () => {
    const ctx = buildCategoryContext({
      category: "letter",
      categoryContext: {
        recipientName: "Ada",
        relationshipNotes: "friend ".repeat(300),
        toneGuidance: "warm",
        apiKey: "do-not-leak",
      },
    });
    expect(ctx.label).toBe("Letter review for Ada");
    expect(ctx.promptBlock).toContain("Recipient: Ada");
    expect(ctx.promptBlock).toContain("Tone guidance: warm");
    expect(ctx.promptBlock).not.toContain("do-not-leak");
    expect(ctx.promptBlock.length).toBeLessThan(3_000);
  });

  it("builds book and other communication lenses", () => {
    const book = buildCategoryContext({ category: "book", categoryContext: { chapterRole: "turning point" } });
    expect(book.promptBlock).toContain("Book chapter");
    expect(book.promptBlock).toContain("turning point");

    const other = buildCategoryContext({ category: "other", categoryContext: { communicationGoal: "ask for help" } });
    expect(other.promptBlock).toContain("Other communication");
    expect(other.promptBlock).toContain("ask for help");
  });

  it("wraps reference context with a desk workflow prompt block", () => {
    const ctx = buildCategoryContext({ category: "article", categoryContext: { targetPlatform: "Substack" } });
    const prompt = withCategoryPrompt("REFS", ctx);
    expect(prompt).toContain("REFS");
    expect(prompt).toContain("DESK WORKFLOW CONTEXT");
    expect(prompt).toContain("Substack");
  });
});
