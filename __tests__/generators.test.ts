import { describe, expect, it, vi } from "vitest";
import {
  PLATFORMS,
  AUDIENCE_PRESETS,
  resolveSources,
  canonicalSource,
  generatePlatform,
  generateOutputs,
  type PlatformOutput,
} from "@/lib/generators";
import type { AI } from "@/lib/llm";

/**
 * Unit tests for the platform generators — no DB, no network. The AI seam is a
 * fake implementing the {@link AI} interface.
 */

/** A fake AI: body call echoes the platform via @@POST@@, metadata returns JSON. */
function fakeAI(): AI {
  return {
    complete: vi.fn(),
    extractJSON: vi.fn(),
    repairJSON: vi.fn(),
    text: vi.fn(async (prompt: string) =>
      `@@POST@@\nBODY for prompt len ${prompt.length}\n@@END@@`,
    ),
    json: vi.fn(async () => ({
      throughlineTag: "#relational-tech",
      strategicPurpose: "Purpose.",
      hooks: ["h1", "h2"],
      ctas: ["c1", "c2"],
      mediaRec: "an image",
      riskCheck: "Clear",
      relatedOffering: "offer",
      followUp: "next post",
    })),
  } as unknown as AI;
}

describe("resolveSources — fixed-order provenance", () => {
  it("all on: each platform derives from its preferred prior outputs", () => {
    const m = resolveSources(["substack", "facebook", "instagram", "x", "threads"]);
    expect(m.substack).toEqual(["__source__"]); // no derivesFrom → canonical
    expect(m.facebook).toEqual(["substack"]);
    expect(m.instagram).toEqual(["facebook"]);
    expect(m.x).toEqual(["substack", "facebook"]);
    expect(m.threads).toEqual(["facebook", "x"]);
  });

  it("Substack OFF: Facebook becomes the canonical source", () => {
    const m = resolveSources(["facebook", "instagram", "x", "threads"]);
    expect(m.facebook).toEqual(["__source__"]);
    expect(m.instagram).toEqual(["facebook"]);
    // x prefers [substack, facebook]; only facebook is on
    expect(m.x).toEqual(["facebook"]);
    expect(m.threads).toEqual(["facebook", "x"]);
  });

  it("only inactive platforms are excluded from the map", () => {
    const m = resolveSources(["instagram", "threads"]);
    expect(Object.keys(m).sort()).toEqual(["instagram", "threads"]);
    // neither preferred prior is on → both fall back to canonical
    expect(m.instagram).toEqual(["__source__"]);
    expect(m.threads).toEqual(["__source__"]);
  });

  it("empty input → empty map", () => {
    expect(resolveSources([])).toEqual({});
  });
});

describe("canonicalSource — prefers revision then original", () => {
  it("uses revision.text when present", () => {
    expect(canonicalSource({ original: "o", revision: { text: "rt" } })).toBe("rt");
  });
  it("falls back to revision.revision", () => {
    expect(canonicalSource({ original: "o", revision: { revision: "rr" } })).toBe("rr");
  });
  it("falls back to original", () => {
    expect(canonicalSource({ original: "o", revision: null })).toBe("o");
  });
  it("empty string when nothing present", () => {
    expect(canonicalSource({})).toBe("");
  });
});

describe("generatePlatform — two calls, exact output shape", () => {
  it("parses the @@POST@@ body and maps metadata into exact fields", async () => {
    const ai = fakeAI();
    const out = await generatePlatform(
      PLATFORMS.find((p) => p.id === "instagram")!,
      { sourceText: "src", priorOutputs: {}, sourceIds: ["__source__"], audienceId: "builders", refCtx: "REF" },
      ai,
    );
    expect(ai.text).toHaveBeenCalledTimes(1);
    expect(ai.json).toHaveBeenCalledTimes(1);

    expect(out.platform).toBe("Instagram");
    expect(out.selectedAudience).toBe("Builders & founders");
    expect(out._platform).toBe("instagram");
    expect(out._audienceId).toBe("builders");
    // leading hash is stripped from the throughline tag
    expect(out.throughlineTag).toBe("relational-tech");
    expect(out.draftPost).toMatch(/^BODY for prompt len/);
    expect(out.hooks).toEqual(["h1", "h2"]);
    expect(out.ctas).toEqual(["c1", "c2"]);
    expect(out.mediaRec).toBe("an image");
    expect(out.riskCheck).toBe("Clear");
    expect(out.relatedOffering).toBe("offer");
    expect(out.followUp).toBe("next post");

    // exact field set (no extras, none missing)
    expect(Object.keys(out).sort()).toEqual(
      [
        "_audienceId", "_platform", "ctas", "draftPost", "followUp", "hooks",
        "mediaRec", "platform", "relatedOffering", "riskCheck",
        "selectedAudience", "strategicPurpose", "throughlineTag",
      ],
    );
  });

  it("unknown audienceId falls back to the first preset", async () => {
    const out = await generatePlatform(
      PLATFORMS[0],
      { sourceText: "s", priorOutputs: {}, sourceIds: ["__source__"], audienceId: "nope", refCtx: "" },
      fakeAI(),
    );
    expect(out.selectedAudience).toBe(AUDIENCE_PRESETS[0].name);
    expect(out._audienceId).toBe(AUDIENCE_PRESETS[0].id);
  });

  it("metadata-call failure degrades to safe defaults, body survives", async () => {
    const ai = fakeAI();
    (ai.json as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const out = await generatePlatform(
      PLATFORMS[0],
      { sourceText: "s", priorOutputs: {}, sourceIds: ["__source__"], audienceId: "leaders", refCtx: "" },
      ai,
    );
    expect(out.throughlineTag).toBe("—");
    expect(out.riskCheck).toBe("Clear");
    expect(out.hooks).toEqual([]);
    expect(out.draftPost).toMatch(/^BODY for prompt len/);
  });
});

describe("generateOutputs — fixed order, threads prior outputs", () => {
  it("runs only active platforms, in PLATFORMS order, returns order array", async () => {
    const ai = fakeAI();
    const res = await generateOutputs(
      { original: "draft" },
      ["x", "substack", "facebook"], // intentionally out of order
      { substack: "leaders", facebook: "builders", x: "general" },
      "REF",
      ai,
    );
    expect(res.order).toEqual(["substack", "facebook", "x"]);
    expect(Object.keys(res.outputs).sort()).toEqual(["facebook", "substack", "x"]);
    // two calls per platform
    expect((ai.text as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    expect((ai.json as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it("threads a prior platform's draftPost into a downstream platform's prompt", async () => {
    const seen: string[] = [];
    const ai = fakeAI();
    (ai.text as ReturnType<typeof vi.fn>).mockImplementation(async (prompt: string) => {
      seen.push(prompt);
      return `@@POST@@\nDRAFT-${seen.length}\n@@END@@`;
    });
    await generateOutputs(
      { original: "draft" },
      ["substack", "facebook"],
      {},
      "",
      ai,
    );
    // facebook derives from substack → its body prompt must include the SUBSTACK version block
    const fbPrompt = seen[1];
    expect(fbPrompt).toContain("=== SUBSTACK VERSION ===");
    expect(fbPrompt).toContain("DRAFT-1");
  });

  it("progress callback fires running/done per platform", async () => {
    const events: Array<[string, string]> = [];
    await generateOutputs(
      { original: "d" },
      ["substack"],
      {},
      "",
      fakeAI(),
      (pid, state) => events.push([pid, state]),
    );
    expect(events).toEqual([["substack", "running"], ["substack", "done"]]);
  });

  it("propagates a body-call failure and reports it via progress", async () => {
    const ai = fakeAI();
    (ai.text as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("down"));
    const events: Array<[string, string]> = [];
    await expect(
      generateOutputs({ original: "d" }, ["substack"], {}, "", ai, (pid, state) =>
        events.push([pid, state]),
      ),
    ).rejects.toThrow("down");
    expect(events).toEqual([["substack", "running"], ["substack", "error"]]);
  });
});
