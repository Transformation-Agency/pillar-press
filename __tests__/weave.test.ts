import { describe, it, expect, vi } from "vitest";
import type { AI } from "@/lib/llm";
import {
  extractSource,
  synthesizeBrief,
  mapToThroughlines,
  draftSection,
  runWeave,
  type WeaveBrief,
  type WeaveExtract,
  type WeaveMapping,
} from "@/lib/weave";

/**
 * Pure-pipeline tests for Weave. No DB, no network — a fake AI records the
 * (prompt, system) pairs and returns canned outputs, exactly the seam the
 * lib functions are designed around (they take an injected `ai: AI`).
 */
function fakeAI(opts: {
  json?: (prompt: string, system?: string) => unknown;
  text?: (prompt: string, system?: string) => string;
}): { ai: AI; jsonCalls: Array<{ prompt: string; system?: string }>; textCalls: Array<{ prompt: string; system?: string }> } {
  const jsonCalls: Array<{ prompt: string; system?: string }> = [];
  const textCalls: Array<{ prompt: string; system?: string }> = [];
  const ai: AI = {
    complete: async () => "",
    json: (async (prompt: string, o?: { system?: string }) => {
      jsonCalls.push({ prompt, system: o?.system });
      return (opts.json ? opts.json(prompt, o?.system) : {}) as never;
    }) as AI["json"],
    text: async (prompt: string, o?: { system?: string }) => {
      textCalls.push({ prompt, system: o?.system });
      return opts.text ? opts.text(prompt, o?.system) : "";
    },
    extractJSON: () => null,
    repairJSON: () => null,
  };
  return { ai, jsonCalls, textCalls };
}

describe("extractSource", () => {
  it("normalizes a partial model response and embeds the source name + text", async () => {
    const { ai, jsonCalls } = fakeAI({ json: () => ({ summary: "s", themes: ["t1"] }) });
    const out = await extractSource({ name: "Doc A", text: "body text here" }, ai);
    expect(out).toEqual({
      name: "Doc A",
      summary: "s",
      themes: ["t1"],
      claims: [],
      signals: [],
      lines: [],
    });
    // VERBATIM prompt shape: SOURCE: "name" then triple-quoted body.
    expect(jsonCalls[0].prompt).toContain('SOURCE: "Doc A"');
    expect(jsonCalls[0].prompt).toContain('"""body text here"""');
    expect(jsonCalls[0].system).toContain("You read ONE source document");
  });
});

describe("synthesizeBrief", () => {
  it("defaults workingTitle and structure when the model omits them", async () => {
    const { ai } = fakeAI({ json: () => ({ concept: "c" }) });
    const extracts: WeaveExtract[] = [
      { name: "A", summary: "sa", themes: [], claims: ["ca"], signals: [], lines: [] },
      { name: "B", summary: "sb", themes: [], claims: [], signals: [], lines: [] },
    ];
    const brief = await synthesizeBrief(extracts, ai);
    expect(brief.workingTitle).toBe("Untitled weave");
    expect(brief.structure).toEqual([{ section: "Whole", purpose: "Make the case", draws: [] }]);
    expect(brief.concept).toBe("c");
  });

  it("renders the [S1]/[S2] extracts block in the prompt", async () => {
    const { ai, jsonCalls } = fakeAI({ json: () => ({}) });
    await synthesizeBrief(
      [
        { name: "A", summary: "sa", themes: ["x"], claims: ["ca"], signals: ["g"], lines: [] },
        { name: "B", summary: "sb", themes: [], claims: [], signals: [], lines: [] },
      ],
      ai,
    );
    expect(jsonCalls[0].prompt).toContain("[S1] A");
    expect(jsonCalls[0].prompt).toContain("[S2] B");
    expect(jsonCalls[0].system).toContain("Weight all sources equally");
  });
});

describe("mapToThroughlines", () => {
  it("injects refCtx into the system prompt and defaults the register", async () => {
    const { ai, jsonCalls } = fakeAI({ json: () => ({ mapped: [{ tag: "x", how: "y" }] }) });
    const brief: WeaveBrief = {
      workingTitle: "T", concept: "c", coreMessage: "m", thread: "th", tensions: [], structure: [],
    };
    const out = await mapToThroughlines(brief, "REFCTX-HERE", ai);
    expect(out.register).toBe("essay");
    expect(out.nearestAngle).toBeNull();
    expect(out.mapped).toEqual([{ tag: "x", how: "y" }]);
    expect(jsonCalls[0].system).toContain("REFCTX-HERE");
  });
});

describe("draftSection", () => {
  it("extracts the body between @@SECTION@@ and @@END@@", async () => {
    const { ai, textCalls } = fakeAI({
      text: () => "preamble\n@@SECTION@@\nThe real prose.\n@@END@@\ntrailing",
    });
    const brief: WeaveBrief = {
      workingTitle: "T", concept: "c", coreMessage: "m", thread: "th", tensions: [],
      structure: [{ section: "One", purpose: "p", draws: ["S1"] }],
    };
    const mapping: WeaveMapping = { mapped: [], nearestAngle: null, audience: "", register: "field" };
    const extracts: WeaveExtract[] = [
      { name: "A", summary: "sa", themes: [], claims: ["ca"], signals: [], lines: ["q"] },
    ];
    const body = await draftSection(brief.structure[0], 0, 1, brief, mapping, extracts, "REF", ai);
    expect(body).toBe("The real prose.");
    // register flows into the system prompt
    expect(textCalls[0].system).toContain("field register");
    // outline marks the section being written
    expect(textCalls[0].prompt).toContain("<-- WRITE THIS ONE");
  });

  it("falls back to trimmed output when delimiters are absent", async () => {
    const { ai } = fakeAI({ text: () => "  just prose, no markers  " });
    const brief: WeaveBrief = {
      workingTitle: "T", concept: "c", coreMessage: "m", thread: "th", tensions: [],
      structure: [{ section: "One", purpose: "p", draws: [] }],
    };
    const mapping: WeaveMapping = { mapped: [], nearestAngle: null, audience: "", register: "essay" };
    const body = await draftSection(brief.structure[0], 0, 1, brief, mapping, [], "REF", ai);
    expect(body).toBe("just prose, no markers");
  });
});

describe("runWeave", () => {
  it("throws when fewer than two usable sources are provided", async () => {
    const { ai } = fakeAI({});
    await expect(runWeave([{ name: "A", text: "short" }], "", ai)).rejects.toThrow(
      "at least two sources",
    );
  });

  it("runs map -> reduce -> map2 -> expand and joins sections into the draft", async () => {
    const ai: AI = {
      complete: async () => "",
      json: (async (prompt: string) => {
        if (prompt.startsWith("SOURCE:")) return { summary: "sum" };
        if (prompt.startsWith("SOURCE EXTRACTS:")) {
          return {
            workingTitle: "Woven",
            concept: "concept",
            coreMessage: "msg",
            thread: "thread",
            structure: [
              { section: "Intro", purpose: "open", draws: ["S1"] },
              { section: "Close", purpose: "land", draws: ["S2"] },
            ],
          };
        }
        // mapToThroughlines
        return { mapped: [], register: "essay" };
      }) as AI["json"],
      text: async () => "@@SECTION@@\nSECTION BODY\n@@END@@",
      extractJSON: () => null,
      repairJSON: () => null,
    };

    const progress = vi.fn();
    const result = await runWeave(
      [
        { name: "A", text: "this source has more than twenty characters" },
        { name: "B", text: "this other source also exceeds twenty chars" },
      ],
      "REF",
      ai,
      progress,
    );

    expect(result.extracts).toHaveLength(2);
    expect(result.brief.workingTitle).toBe("Woven");
    expect(result.mapping.register).toBe("essay");
    // two sections, each "SECTION BODY", joined by a blank line
    expect(result.draft).toBe("SECTION BODY\n\nSECTION BODY");
    expect(typeof result.generatedAt).toBe("number");

    const phases = progress.mock.calls.map((c) => c[0].phase);
    expect(phases).toEqual(["extract", "extract", "brief", "map", "draft", "draft", "done"]);
  });

  it("uses a fallback extract when extractSource throws, and keeps going", async () => {
    let firstExtract = true;
    const ai: AI = {
      complete: async () => "",
      json: (async (prompt: string) => {
        if (prompt.startsWith("SOURCE:")) {
          if (firstExtract) { firstExtract = false; throw new Error("boom"); }
          return { summary: "ok" };
        }
        if (prompt.startsWith("SOURCE EXTRACTS:")) {
          return { workingTitle: "W", structure: [{ section: "S", purpose: "p", draws: [] }] };
        }
        return { mapped: [], register: "essay" };
      }) as AI["json"],
      text: async () => "@@SECTION@@\nBODY\n@@END@@",
      extractJSON: () => null,
      repairJSON: () => null,
    };

    const result = await runWeave(
      [
        { name: "A", text: "first source over twenty characters long here" },
        { name: "B", text: "second source over twenty characters long too" },
      ],
      "",
      ai,
    );
    // failed extract falls back to a sliced summary of the source text
    expect(result.extracts[0].summary).toContain("first source over twenty");
    expect(result.extracts[1].summary).toBe("ok");
    expect(result.draft).toBe("BODY");
  });
});
