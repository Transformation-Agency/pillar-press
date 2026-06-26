import { describe, it, expect } from "vitest";
import { GATES, PREAMBLE, SEVERITY, runGate, type GateResult } from "@/lib/gates";
import { buildCategoryContext } from "@/lib/editorial/categoryContext";
import { chooseReviewPlan, runCategoryAwareReview, runGateWithContext } from "@/lib/editorial/review";
import { LLMError, type AI } from "@/lib/llm";

// A fake AI that records the prompts/systems it was called with and returns a
// canned JSON object. Proves the gate logic is PURE — no DB, no network.
function fakeAI(respond: (prompt: string, system?: string) => unknown): AI & {
  calls: { prompt: string; system?: string }[];
} {
  const calls: { prompt: string; system?: string }[] = [];
  return {
    calls,
    async json<T>(prompt: string, opts?: { system?: string }) {
      calls.push({ prompt, system: opts?.system });
      return respond(prompt, opts?.system) as T;
    },
    async text() { throw new Error("not used"); },
    async complete() { throw new Error("not used"); },
    extractJSON: () => null,
    repairJSON: () => null,
  };
}

describe("GATES definition", () => {
  it("defines the 7 gates in order", () => {
    expect(GATES.map((g) => g.id)).toEqual([
      "strategy", "audience", "tone", "rigor", "stress", "clarity", "self",
    ]);
    expect(GATES.map((g) => g.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("embeds the draft into each task prompt", () => {
    for (const g of GATES) {
      const t = g.task("HELLO DRAFT");
      expect(t).toContain('"""HELLO DRAFT"""');
      expect(t).toContain("findings");
    }
  });

  it("PREAMBLE embeds the ref context and forbids prose/fences", () => {
    const p = PREAMBLE("MY REF CTX");
    expect(p).toContain("MY REF CTX");
    expect(p).toContain("Return ONLY valid JSON. No prose outside the JSON. No code fences.");
  });

  it("exposes the three severities", () => {
    expect(Object.keys(SEVERITY)).toEqual(["must", "consider", "note"]);
    expect(SEVERITY.must.rank).toBe(0);
  });
});

describe("runGate normalization", () => {
  it("passes the gate task as prompt and PREAMBLE(refCtx) as system", async () => {
    const ai = fakeAI(() => ({ summary: "ok", findings: [] }));
    await runGate(GATES[0], "DRAFT", "REFCTX", ai);
    expect(ai.calls[0].prompt).toBe(GATES[0].task("DRAFT"));
    expect(ai.calls[0].system).toBe(PREAMBLE("REFCTX"));
  });

  it("coerces unknown severities to note and missing fields to defaults", async () => {
    const ai = fakeAI(() => ({
      summary: "s",
      findings: [
        { severity: "bogus", title: "", detail: "", anchor: "" },
        { severity: "must", title: "T", detail: "D", anchor: "quote" },
      ],
    }));
    const res = (await runGate(GATES[5], "DRAFT", "REF", ai)) as GateResult;
    expect(res.findings[0]).toEqual({ severity: "note", title: "Finding", detail: "", anchor: null });
    expect(res.findings[1]).toEqual({ severity: "must", title: "T", detail: "D", anchor: "quote" });
  });

  it("tolerates a result with no findings array", async () => {
    const ai = fakeAI(() => ({ summary: "s" }));
    const res = await runGate(GATES[2], "DRAFT", "REF", ai);
    expect(res.findings).toEqual([]);
  });

  it("defaults a completely omitted anchor to null", async () => {
    // anchor key absent entirely (not just empty string) must normalize to null
    const ai = fakeAI(() => ({
      summary: "s",
      findings: [{ severity: "consider", title: "T", detail: "D" }],
    }));
    const res = (await runGate(GATES[5], "DRAFT", "REF", ai)) as GateResult;
    expect(res.findings[0].anchor).toBeNull();
  });

  it("injects category context into the gate system prompt", async () => {
    const ai = fakeAI(() => ({ summary: "ok", findings: [] }));
    const categoryCtx = buildCategoryContext({ category: "letter", categoryContext: { recipientName: "Ada" } });
    await runGateWithContext(GATES[0], "DRAFT", { refCtx: "REF", categoryCtx, ai });
    expect(ai.calls[0].system).toContain("DESK WORKFLOW CONTEXT");
    expect(ai.calls[0].system).toContain("Letter / direct communication");
    expect(ai.calls[0].system).toContain("Ada");
  });

  it("selects chunked review for very long drafts", () => {
    const categoryCtx = buildCategoryContext({ category: "book" });
    const plan = chooseReviewPlan({
      draft: "Long paragraph. ".repeat(40_000),
      refCtx: "REF",
      categoryCtx,
      taskAI: { provider: "ollama", model: "small-local" },
    });
    expect(plan.plan).toBe("chunked_reduce");
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.warnings[0]).toContain("long_input_chunked");
  });

  it("runs review with category trace metadata and category-aware systems", async () => {
    const ai = fakeAI(() => ({ summary: "ok", findings: [] }));
    const categoryCtx = buildCategoryContext({
      category: "letter",
      categoryContext: { recipientName: "Ada", toneGuidance: "warm but direct" },
    });

    const result = await runCategoryAwareReview({
      draft: "Dear Ada, thank you for yesterday.",
      refCtx: "REF",
      categoryCtx,
      taskAI: { provider: "ollama", model: "gemma4:26b-mlx" },
      ai,
    });

    expect(result.trace).toMatchObject({
      category: "letter",
      categoryLabel: "Letter: Ada",
      plan: "single_pass",
      chunks: 1,
    });
    expect(result.callCount).toBe(GATES.length);
    expect(ai.calls.every((call) => call.system?.includes("Letter / direct communication"))).toBe(true);
    expect(ai.calls.every((call) => call.system?.includes("warm but direct"))).toBe(true);
  });

  it("keeps a review packet when a gate returns malformed JSON", async () => {
    const ai = fakeAI((prompt) => {
      if (prompt.includes("TASK — Self-alignment")) {
        throw new LLMError(502, "llm_parse", "Could not parse JSON from model output.", "ollama");
      }
      return { summary: "ok", findings: [] };
    });
    const persisted: unknown[] = [];

    const result = await runCategoryAwareReview({
      draft: "A small draft.",
      refCtx: "REF",
      categoryCtx: buildCategoryContext({ category: "article" }),
      taskAI: { provider: "ollama", model: "gemma4:26b-mlx" },
      ai,
      onGate(packet) {
        persisted.push(JSON.parse(JSON.stringify(packet)));
      },
    });

    expect(result.packet.self).toMatchObject({
      summary: expect.stringContaining("Self-alignment could not be parsed"),
      warning: "llm_parse",
      findings: [{ severity: "consider", title: "Gate needs retry", anchor: null }],
    });
    expect(result.trace.warnings).toContain("gate_failed:self");
    expect(result.trace.stages.at(-1)).toMatchObject({ id: "self", status: "failed" });
    expect(persisted.length).toBeGreaterThan(0);
  });
});
