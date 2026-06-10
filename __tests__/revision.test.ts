import { describe, expect, it, vi } from "vitest";
import {
  chunkText,
  parseDelimited,
  collectFirewallFindings,
  buildFindingsBlock,
  buildFullFindingsBlock,
  REVISION_SYSTEM,
  RESTRUCTURE_SYSTEM,
  buildGuidance,
  generateRevision,
  type RevisionPacket,
} from "@/lib/revision";
import type { AI } from "@/lib/llm";

describe("author guidance (direction + gate commentary)", () => {
  it("builds a labelled commentary block and skips empty notes", () => {
    const g = buildGuidance({ direction: "  Lead with stakes ", gateNotes: { clarity: "punchy", tone: "  ", self: "sound like me" } });
    expect(g.hasGuidance).toBe(true);
    expect(g.direction).toBe("Lead with stakes");
    expect(g.notesBlock).toContain("• Clarity: punchy");
    expect(g.notesBlock).toContain("• Self-alignment: sound like me");
    expect(g.notesBlock).not.toContain("Tone & register"); // empty note skipped
  });

  it("injects the (e) clause + blocks only when guidance is present", () => {
    const withG = REVISION_SYSTEM("REF", buildGuidance({ direction: "D", gateNotes: { clarity: "c" } }));
    expect(withG).toContain("(e)");
    expect(withG).toContain("[DIR]");
    expect(withG).toContain("AUTHOR'S CREATIVE DIRECTION");
    expect(withG).toContain("AUTHOR COMMENTARY BY REVIEW SECTION");
    const without = REVISION_SYSTEM("REF", buildGuidance({}));
    expect(without).not.toContain("(e)");
    expect(without).not.toContain("AUTHOR COMMENTARY BY REVIEW SECTION");
  });
});

/* ------------------------------------------------------------------ *
 * chunkText
 * ------------------------------------------------------------------ */

describe("chunkText", () => {
  it("returns the original (single chunk) for empty / short text", () => {
    expect(chunkText("")).toEqual([""]);
    expect(chunkText("hello world")).toEqual(["hello world"]);
  });

  it("packs paragraphs up to the word budget, splitting on blank lines", () => {
    const p = (n: number) => Array(n).fill("word").join(" ");
    // two ~200-word paragraphs should NOT fit together under 260 words.
    const text = `${p(200)}\n\n${p(200)}`;
    const chunks = chunkText(text, 260);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(p(200));
    expect(chunks[1]).toBe(p(200));
  });

  it("splits an over-budget paragraph by sentences", () => {
    const sentence = "This is a sentence with several words in it. ";
    const big = sentence.repeat(40); // ~360 words, one paragraph
    const chunks = chunkText(big, 260);
    expect(chunks.length).toBeGreaterThan(1);
    // every chunk stays within budget
    for (const c of chunks) {
      const words = c.trim().split(/\s+/).filter(Boolean).length;
      expect(words).toBeLessThanOrEqual(260);
    }
  });

  it("keeps small paragraphs combined under budget", () => {
    const text = "Short one.\n\nShort two.\n\nShort three.";
    expect(chunkText(text, 260)).toEqual([text]);
  });
});

/* ------------------------------------------------------------------ *
 * parseDelimited
 * ------------------------------------------------------------------ */

describe("parseDelimited", () => {
  it("extracts the revision body and strips delimiters", () => {
    const out = `@@REVISION@@
The revised line, kept clean.

A second paragraph.
@@CHANGELOG@@
- [C1] tightened the opening :: was wordy
@@END@@`;
    const { revision, changelog } = parseDelimited(out);
    expect(revision).toBe("The revised line, kept clean.\n\nA second paragraph.");
    expect(changelog).toEqual([
      { finding: "C1", change: "tightened the opening", note: "was wordy" },
    ]);
  });

  it("parses C#/T#/I# finding ids and drops an optional [severity] tag", () => {
    const out = `@@REVISION@@
body
@@CHANGELOG@@
- [T2] [must] softened the jab :: tone
- I3 added an inoculation clause :: defuses misread
- [c10] lowercased id normalizes :: x
@@END@@`;
    const { changelog } = parseDelimited(out);
    expect(changelog).toEqual([
      { finding: "T2", change: "softened the jab", note: "tone" },
      { finding: "I3", change: "added an inoculation clause", note: "defuses misread" },
      { finding: "C10", change: "lowercased id normalizes", note: "x" },
    ]);
  });

  it("returns empty changelog and trims stray delimiters when no REVISION marker", () => {
    const out = "just some text\n@@CHANGELOG@@\n- [C1] x :: y\n@@END@@";
    const { revision, changelog } = parseDelimited(out);
    expect(revision).toBe("just some text");
    expect(changelog).toEqual([]);
  });

  it("ignores changelog lines without a change", () => {
    const out = `@@REVISION@@
body
@@CHANGELOG@@
- [C1]
-
@@END@@`;
    expect(parseDelimited(out).changelog).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * FIREWALL — only clarity / tone / inoculation may pass.
 * ------------------------------------------------------------------ */

const FULL_PACKET = {
  // FORBIDDEN slices — must never appear in the findings block.
  strategy: { findings: [{ severity: "must", title: "STRAT", detail: "no", anchor: null }] },
  audience: { findings: [{ severity: "must", title: "AUD", detail: "no", anchor: null }] },
  rigor: { findings: [{ severity: "must", title: "RIGOR", detail: "no", anchor: null }] },
  self: { findings: [{ severity: "must", title: "IDENT", detail: "no", anchor: null }] },
  // ALLOWED slices.
  clarity: {
    findings: [{ severity: "must", title: "Tighten", detail: "wordy", anchor: "the thing" }],
  },
  tone: { findings: [{ severity: "consider", title: "Warm up", detail: "cold" }] },
  stress: {
    screenshotTests: [{ quote: "hot take", misread: "bad", inoculation: "add nuance" }],
  },
} as unknown as RevisionPacket;

describe("firewall (collectFirewallFindings / buildFindingsBlock)", () => {
  it("collects ONLY clarity, tone, and screenshot-test inoculations", () => {
    const { clarity, tone, inoc } = collectFirewallFindings(FULL_PACKET);
    expect(clarity).toHaveLength(1);
    expect(tone).toHaveLength(1);
    expect(inoc).toHaveLength(1);
  });

  it("never leaks strategy / audience / rigor / identity into the findings block", () => {
    const block = buildFindingsBlock(FULL_PACKET);
    for (const forbidden of ["STRAT", "AUD", "RIGOR", "IDENT"]) {
      expect(block).not.toContain(forbidden);
    }
    expect(block).toContain('C1 [must] Tighten — wordy (re: "the thing")');
    expect(block).toContain("T1 [consider] Warm up — cold");
    expect(block).toContain('I1 re "hot take": add nuance');
  });

  it("tolerates a missing / empty packet", () => {
    expect(buildFindingsBlock(null)).toContain("CLARITY FINDINGS:");
    expect(buildFindingsBlock({})).toContain("INOCULATIONS (from screenshot test):");
  });
});

/* ------------------------------------------------------------------ *
 * REVISION_SYSTEM — the firewall is stated in the prompt.
 * ------------------------------------------------------------------ */

describe("REVISION_SYSTEM", () => {
  it("interpolates refCtx and states the firewall + author-line-wins rule", () => {
    const sys = REVISION_SYSTEM("REF-CONTEXT-HERE");
    expect(sys).toContain("REF-CONTEXT-HERE");
    expect(sys).toContain("do NOT act on strategy, audience, rigor, or identity concerns");
    expect(sys).toContain("the AUTHOR'S LINE WINS");
    expect(sys).toContain("@@REVISION@@");
    expect(sys).toContain("@@CHANGELOG@@");
    expect(sys).toContain("@@END@@");
  });
});

/* ------------------------------------------------------------------ *
 * generateRevision — pure, driven by a fake AI.
 * ------------------------------------------------------------------ */

function fakeAI(text: (prompt: string, opts?: { system?: string }) => Promise<string> | string): AI {
  return {
    text: vi.fn(async (p: string, o?: { system?: string }) => text(p, o)),
    complete: vi.fn(),
    json: vi.fn(),
    extractJSON: vi.fn(),
    repairJSON: vi.fn(),
  } as unknown as AI;
}

describe("generateRevision", () => {
  it("processes each chunk and joins the revised passages with blank lines", async () => {
    const p = (n: number) => Array(n).fill("word").join(" ");
    const original = `${p(200)}\n\n${p(200)}`; // -> 2 chunks
    let call = 0;
    const ai = fakeAI(() => {
      call += 1;
      return `@@REVISION@@\nrevised ${call}\n@@CHANGELOG@@\n- [C1] change ${call} :: why\n@@END@@`;
    });
    const onProgress = vi.fn();
    const result = await generateRevision({ original, packet: FULL_PACKET }, "REF", ai, onProgress);

    expect(ai.text).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("revised 1\n\nrevised 2");
    expect(result.changelog).toEqual([
      { finding: "C1", change: "change 1", note: "why" },
      { finding: "C1", change: "change 2", note: "why" },
    ]);
    // progress reported per-chunk plus a final tick.
    expect(onProgress).toHaveBeenCalledWith(0, 2);
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it("keeps the original chunk when a passage call throws", async () => {
    const ai = fakeAI(() => {
      throw new Error("boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await generateRevision({ original: "keep me", packet: {} }, "REF", ai);
    expect(result.text).toBe("keep me");
    expect(result.changelog).toEqual([]);
    warn.mockRestore();
  });

  it("keeps the original chunk when the model returns a too-short body", async () => {
    const ai = fakeAI(() => `@@REVISION@@\n.\n@@CHANGELOG@@\n@@END@@`);
    const result = await generateRevision({ original: "the real text", packet: {} }, "REF", ai);
    expect(result.text).toBe("the real text");
  });

  it("passes the firewall system prompt (no forbidden findings) to the AI", async () => {
    let seenSystem = "";
    let seenPrompt = "";
    const ai = fakeAI((prompt, opts) => {
      seenSystem = opts?.system ?? "";
      seenPrompt = prompt;
      return `@@REVISION@@\nrevised body here\n@@END@@`;
    });
    await generateRevision({ original: "hello there", packet: FULL_PACKET }, "REFCTX", ai);
    expect(seenSystem).toContain("REFCTX");
    for (const forbidden of ["STRAT", "AUD", "RIGOR", "IDENT"]) {
      expect(seenPrompt).not.toContain(forbidden);
    }
    expect(seenPrompt).toContain('C1 [must] Tighten — wordy');
  });
});

/* ------------------------------------------------------------------ *
 * FULL mode — restructure (strategy/structure/etc.) then polish.
 * ------------------------------------------------------------------ */

describe("buildFullFindingsBlock", () => {
  it("includes strategy / audience / rigor / self with S/A/R/V ids", () => {
    const block = buildFullFindingsBlock(FULL_PACKET);
    expect(block).toContain("S1 [must] STRAT — no");
    expect(block).toContain("A1 [must] AUD — no");
    expect(block).toContain("R1 [must] RIGOR — no");
    expect(block).toContain("V1 [must] IDENT — no");
  });
});

describe("RESTRUCTURE_SYSTEM", () => {
  it("permits reorganization and protects the author's voice", () => {
    const sys = RESTRUCTURE_SYSTEM("REFX");
    expect(sys).toContain("REFX");
    expect(sys).toMatch(/reorganize|reorder/i);
    expect(sys).toContain("PRESERVE the author's VOICE");
    expect(sys).toContain("@@REVISION@@");
  });
});

describe("generateRevision — full mode", () => {
  const isRestructure = (sys?: string) => !!sys && sys.includes("structural editor");

  it("runs a whole-document restructure first, then the per-passage polish", async () => {
    const calls: string[] = [];
    const ai = fakeAI((_p, o) => {
      const restructure = isRestructure(o?.system);
      calls.push(restructure ? "restructure" : "passage");
      return restructure
        ? `@@REVISION@@\nrestructured doc\n@@CHANGELOG@@\n- [S1] reordered the opening :: lead with stakes\n- [STRUCT] merged two sections :: tighter\n@@END@@`
        : `@@REVISION@@\npolished passage\n@@CHANGELOG@@\n- [C1] tightened :: wordy\n@@END@@`;
    });
    const result = await generateRevision({ original: "some original text", packet: FULL_PACKET }, "REF", ai, undefined, { mode: "full" });

    expect(calls[0]).toBe("restructure");
    expect(calls.slice(1).every((c) => c === "passage")).toBe(true);
    expect(result.text).toBe("polished passage");
    // structural changelog entries come first (bracketed ids parsed), then per-passage
    expect(result.changelog[0]).toEqual({ finding: "S1", change: "reordered the opening", note: "lead with stakes" });
    expect(result.changelog).toContainEqual({ finding: "STRUCT", change: "merged two sections", note: "tighter" });
    expect(result.changelog).toContainEqual({ finding: "C1", change: "tightened", note: "wordy" });
  });

  it("feeds strategy/audience/rigor/self into the restructure step (which the firewall excludes)", async () => {
    let restructurePrompt = "";
    const ai = fakeAI((p, o) => {
      if (isRestructure(o?.system)) { restructurePrompt = p; return `@@REVISION@@\nrs body\n@@END@@`; }
      return `@@REVISION@@\npp body\n@@END@@`;
    });
    await generateRevision({ original: "x y z", packet: FULL_PACKET }, "REF", ai, undefined, { mode: "full" });
    for (const wanted of ["STRAT", "AUD", "RIGOR", "IDENT"]) expect(restructurePrompt).toContain(wanted);
  });

  it("light mode (default) never invokes the restructure step", async () => {
    const systems: string[] = [];
    const ai = fakeAI((_p, o) => { systems.push(o?.system ?? ""); return `@@REVISION@@\nbody body\n@@END@@`; });
    await generateRevision({ original: "hello there", packet: FULL_PACKET }, "REF", ai); // default light
    expect(systems.some(isRestructure)).toBe(false);
  });

  it("falls back to per-passage polish if the restructure call throws", async () => {
    const ai = fakeAI((_p, o) => {
      if (isRestructure(o?.system)) throw new Error("restructure boom");
      return `@@REVISION@@\npolished only\n@@END@@`;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await generateRevision({ original: "original body", packet: {} }, "REF", ai, undefined, { mode: "full" });
    expect(result.text).toBe("polished only");
    warn.mockRestore();
  });
});
