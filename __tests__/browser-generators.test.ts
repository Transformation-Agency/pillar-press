import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function loadBrowserGenerators(fetch: unknown) {
  const source = readFileSync(new URL("../public/generators.js", import.meta.url), "utf8");
  const window = { fetch } as Record<string, unknown>;
  runInNewContext(source, { window, fetch });
  return window.GEN as any;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

describe("browser generator API wrapper", () => {
  it("generates revision through the server route and preserves trace/status", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const gen = loadBrowserGenerators(async (url: string, init: any) => {
      calls.push({ url, init });
      return jsonResponse({
        piece: {
          revision: {
            text: "Revised draft",
            changelog: [{ finding: "C1", change: "tightened", note: "clarity" }],
            trace: { plan: "light_polish", chunks: 1 },
            status: "complete",
          },
        },
      });
    });

    const result = await gen.generateRevision({ id: "piece_1" }, "REF", undefined, { mode: "full" });

    expect(calls[0].url).toBe("/api/pieces/piece_1/revision");
    expect(JSON.parse(calls[0].init.body)).toEqual({ mode: "full" });
    expect(result).toEqual({
      revision: "Revised draft",
      changelog: [{ finding: "C1", change: "tightened", note: "clarity" }],
      trace: { plan: "light_polish", chunks: 1 },
      status: "complete",
    });
  });

  it("surfaces readable server errors instead of only HTTP status text", async () => {
    const gen = loadBrowserGenerators(async () =>
      jsonResponse({ error: "Reconnect the revision model before trying again." }, false, 502)
    );

    await expect(gen.generateRevision({ id: "piece_1" }, "REF")).rejects.toThrow(
      "Reconnect the revision model before trying again.",
    );
  });

  it("generates outputs through the server route in fixed platform order", async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const events: Array<[string, string, unknown?]> = [];
    const gen = loadBrowserGenerators(async (url: string, init: any) => {
      calls.push({ url, init });
      return jsonResponse({
        outputs: {
          substack: { platform: "Substack", draftPost: "Substack post" },
          facebook: { platform: "Facebook", draftPost: "Facebook post" },
        },
        outputOrder: ["substack", "facebook"],
      });
    });

    const result = await gen.generateOutputs(
      { id: "piece_1" },
      ["facebook", "substack"],
      { substack: "builders", facebook: "existing audience" },
      "REF",
      (pid: string, status: string, output?: unknown) => events.push([pid, status, output]),
    );

    expect(calls[0].url).toBe("/api/pieces/piece_1/outputs");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      active: ["facebook", "substack"],
      audiences: { substack: "builders", facebook: "existing audience" },
    });
    expect(result.order).toEqual(["substack", "facebook"]);
    expect(result.outputs.facebook.draftPost).toBe("Facebook post");
    expect(events).toEqual([
      ["substack", "running", undefined],
      ["facebook", "running", undefined],
      ["substack", "done", { platform: "Substack", draftPost: "Substack post" }],
      ["facebook", "done", { platform: "Facebook", draftPost: "Facebook post" }],
    ]);
  });

  it("falls back to piece outputs and reports readable output-generation errors", async () => {
    const gen = loadBrowserGenerators(async () =>
      jsonResponse({
        piece: {
          outputs: { x: { platform: "X", draftPost: "Short post" } },
          outputOrder: ["x"],
        },
      })
    );

    await expect(gen.generateOutputs({ id: "piece_1" }, ["x"], {}, "")).resolves.toEqual({
      outputs: { x: { platform: "X", draftPost: "Short post" } },
      order: ["x"],
    });

    const events: Array<[string, string, string?]> = [];
    const failing = loadBrowserGenerators(async () =>
      jsonResponse({ error: "Reconnect the outputs model before generating platform posts." }, false, 502)
    );

    await expect(
      failing.generateOutputs({ id: "piece_1" }, ["substack"], {}, "", (pid: string, status: string, _output: unknown, err?: Error) =>
        events.push([pid, status, err?.message]),
      ),
    ).rejects.toThrow("Reconnect the outputs model before generating platform posts.");
    expect(events).toEqual([
      ["substack", "running", undefined],
      ["substack", "error", "Reconnect the outputs model before generating platform posts."],
    ]);
  });
});
