import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function loadBrowserWeave(fetch: unknown, store: Record<string, unknown> = {}) {
  const source = readFileSync(new URL("../public/weave.js", import.meta.url), "utf8");
  const window = { Store: store } as Record<string, unknown>;
  runInNewContext(source, { window, fetch, Date, console });
  return window.WEAVE as any;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

const result = {
  extracts: [{ name: "Source A", summary: "A" }],
  brief: {
    workingTitle: "Woven Draft",
    coreMessage: "The center holds.",
    concept: "A joined idea",
    thread: "A shared thread",
    tensions: ["Speed vs depth"],
    structure: [{ section: "Opening", purpose: "Orient the reader" }],
  },
  mapping: {
    mapped: [{ tag: "Local-first", how: "Grounds the piece" }],
    nearestAngle: "Use practical examples",
    audience: "Editors",
    register: "essay",
  },
  draft: "Generated unified draft",
  generatedAt: 12345,
};

describe("browser Weave API wrapper", () => {
  it("posts only usable sources, reports progress, and normalizes the result", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const progress: unknown[] = [];
    const weave = loadBrowserWeave(async (url: string, init: any) => {
      calls.push({ url, init });
      return jsonResponse(result);
    });

    const output = await weave.runWeave([
      { name: "Too short", text: "brief" },
      { name: "Source A", text: "This source has more than twenty characters." },
      { name: "Source B", text: "This second source also has enough content." },
    ], "ignored browser ref ctx", (p: unknown) => progress.push(p), { campaignId: "camp_local" });

    expect(calls[0].url).toBe("/api/weave");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      sources: [
        { name: "Source A", text: "This source has more than twenty characters." },
        { name: "Source B", text: "This second source also has enough content." },
      ],
      campaignId: "camp_local",
    });
    expect(output).toEqual(result);
    expect(progress).toEqual([
      { phase: "extract", i: 0, total: 2, name: "Source A" },
      { phase: "brief" },
      { phase: "map" },
      { phase: "draft", i: 0, total: 1, name: "draft" },
      { phase: "done" },
    ]);
  });

  it("surfaces readable route errors and blocks runs with fewer than two usable sources", async () => {
    const weave = loadBrowserWeave(async () =>
      jsonResponse({ error: "Reconnect the Weave model before trying again." }, false, 502)
    );

    await expect(weave.runWeave([
      { name: "Source A", text: "This source has more than twenty characters." },
      { name: "Source B", text: "This second source also has enough content." },
    ])).rejects.toThrow("Reconnect the Weave model before trying again.");

    await expect(weave.runWeave([
      { name: "Only", text: "This source has more than twenty characters." },
    ])).rejects.toThrow("Add at least two sources with content to weave.");
  });

  it("formats the brief and sends the generated draft to Library", () => {
    const createdPieces: Array<{ title: string; campaignId: string | null; opts: any }> = [];
    const openPiece = vi.fn();
    const weave = loadBrowserWeave(vi.fn(), {
      createPiece: vi.fn((title: string, campaignId: string | null, opts: any) => {
        createdPieces.push({ title, campaignId, opts });
        return { id: "piece_1", title, ...opts };
      }),
    });

    expect(weave.briefToText(result)).toContain("WEAVE BRIEF — Woven Draft");
    expect(weave.briefToText(result)).toContain("Local-first (Grounds the piece)");

    const piece = weave.sendResultToLibrary(result, openPiece);

    expect(piece).toMatchObject({ id: "piece_1", title: "Woven Draft", original: "Generated unified draft" });
    expect(createdPieces).toEqual([
      { title: "Woven Draft", campaignId: null, opts: { original: "Generated unified draft" } },
    ]);
    expect(openPiece).toHaveBeenCalledWith("piece_1");
  });

  it("wires Weave screens to send campaign ids for reference-aware synthesis", () => {
    const app = readFileSync(new URL("../public/app.jsx", import.meta.url), "utf8");
    const screen = readFileSync(new URL("../public/screen-weave.jsx", import.meta.url), "utf8");
    const book = readFileSync(new URL("../public/screen-book.jsx", import.meta.url), "utf8");

    expect(app).toContain("<Weave weave={window.Store.getWeave()} refCtx={refCtx} campaignId={activeCampaign.id} onOpenPiece={openPiece} />");
    expect(screen).toContain("function Weave({ weave, refCtx, campaignId, onOpenPiece })");
    expect(screen).toContain("window.WEAVE.runWeave(sources, refCtx, (p) => setProgress(p), { campaignId })");
    expect(book).toContain("function SourcePack({ piece, refCtx, campaignId, onDraft, busy, setBusy, setErr })");
    expect(book).toContain("window.WEAVE.runWeave(sources, refCtx, (p) => setProg(p), { campaignId: campaignId || piece.campaignId })");
  });
});
