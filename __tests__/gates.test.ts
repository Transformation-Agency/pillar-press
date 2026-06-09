import { describe, it, expect } from "vitest";
import { GATES, PREAMBLE, SEVERITY, runGate, type GateResult } from "@/lib/gates";
import type { AI } from "@/lib/llm";

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
});
