import { describe, expect, it } from "vitest";
import {
  outputMarkdown,
  pieceOutputsMarkdown,
  safeName,
  type OutputObject,
  type PieceForExport,
} from "@/lib/exporters";

/**
 * Golden-string assertions for the markdown exporters (Unit U4.2).
 *
 * The expected strings are independent literals reproducing the BYTE-IDENTICAL
 * output of prototype-reference/exporters.js so any drift in the port — changed
 * headings, lost blank lines, reordered fields — fails the test.
 */

const SAMPLE: OutputObject = {
  platform: "Substack",
  selectedAudience: "Builders",
  throughlineTag: "agency",
  strategicPurpose: "Establish authority.",
  draftPost: "The body of the post.\nSecond line.",
  hooks: ["Hook one", "Hook two"],
  ctas: ["Subscribe", "Reply"],
  mediaRec: "A single hero image.",
  riskCheck: "Clear",
  relatedOffering: "The cohort.",
  followUp: "A follow-up next week.",
};

const SAMPLE_MD = [
  "# Substack",
  "",
  "- **Audience:** Builders",
  "- **Throughline:** #agency",
  "- **Strategic purpose:** Establish authority.",
  "",
  "## Post",
  "",
  "The body of the post.\nSecond line.",
  "",
  "## Hook options",
  "- Hook one",
  "- Hook two",
  "",
  "## CTA options",
  "- Subscribe",
  "- Reply",
  "",
  "## Production",
  "- **Imagery / media:** A single hero image.",
  "- **Risk & boundary:** Clear",
  "- **Related offering:** The cohort.",
  "- **Suggested follow-up:** A follow-up next week.",
  "",
].join("\n");

describe("outputMarkdown", () => {
  it("reproduces the prototype markdown structure verbatim", () => {
    expect(outputMarkdown(SAMPLE)).toBe(SAMPLE_MD);
  });

  it("tolerates missing hooks/ctas and empty draft", () => {
    const md = outputMarkdown({
      ...SAMPLE,
      draftPost: "",
      hooks: undefined,
      ctas: undefined,
    });
    expect(md).toContain("## Hook options\n\n## CTA options");
    expect(md).toContain("## Post\n\n\n"); // empty body keeps the blank lines
  });
});

describe("pieceOutputsMarkdown", () => {
  it("joins outputs in outputOrder with delimiters and skips unknown ids", () => {
    const piece: PieceForExport = {
      title: "My Piece",
      outputs: { substack: SAMPLE },
      outputOrder: ["substack", "missing-id"],
    };
    const expected = [
      "# My Piece — Platform outputs",
      "",
      "---",
      "",
      SAMPLE_MD,
      "",
    ].join("\n");
    expect(pieceOutputsMarkdown(piece)).toBe(expected);
  });

  it("handles a piece with no outputOrder", () => {
    expect(pieceOutputsMarkdown({ title: "Empty", outputs: {} })).toBe(
      "# Empty — Platform outputs\n",
    );
  });
});

describe("safeName", () => {
  it("strips unsafe chars, collapses spaces, and falls back", () => {
    expect(safeName("Hello, World!")).toBe("Hello-World");
    expect(safeName("")).toBe("untitled");
    expect(safeName("***")).toBe("untitled");
  });
});
