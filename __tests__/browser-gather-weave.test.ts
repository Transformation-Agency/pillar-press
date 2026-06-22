import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function loadBrowserGather(store: Record<string, unknown>) {
  const source = readFileSync(new URL("../public/gather.js", import.meta.url), "utf8");
  const window = {
    Store: store,
    localStorage: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    },
    crypto: { randomUUID: vi.fn(() => "uuid_1") },
  } as Record<string, unknown>;
  runInNewContext(source, {
    window,
    fetch: vi.fn(),
    setTimeout: vi.fn(),
    setInterval: vi.fn(),
    Date,
    Math,
    console,
  });
  return window;
}

describe("browser Gather to Weave handoff", () => {
  it("formats gathered item text and stages selected research as Weave sources", () => {
    const added: Array<{ name: string; text: string }> = [];
    const window = loadBrowserGather({
      addWeaveSource: vi.fn((name: string, text: string) => {
        const source = { name, text };
        added.push(source);
        return source;
      }),
    });

    const item = {
      title: "A very long research title that should be shortened before Weave intake",
      source: "Journal",
      author: "Ada",
      date: "2026-06-21",
      snippet: "Snippet fallback",
      transcript: "Full transcript wins.",
    };

    const created = (window.GATHER as any).sendGatherItemsToWeave([item]);

    expect(created).toEqual(added);
    expect(window.__weaveSourcesAdded).toBe(true);
    expect(added).toEqual([
      {
        name: "A very long research title that should be shorte",
        text: [
          item.title,
          "(Journal · Ada · 2026-06-21)",
          "",
          "Full transcript wins.",
        ].join("\n"),
      },
    ]);
  });

  it("stages source summaries, dismisses them from Gather, and labels query-only briefs", () => {
    const added: Array<{ name: string; text: string }> = [];
    const removed: string[] = [];
    const window = loadBrowserGather({
      addWeaveSource: vi.fn((name: string, text: string) => {
        const source = { name, text };
        added.push(source);
        return source;
      }),
      removeGatherSummary: vi.fn((id: string) => removed.push(id)),
    });

    const created = (window.GATHER as any).sendGatherSummariesToWeave([
      {
        id: "summary_1",
        kind: "web",
        label: "",
        query: "local-first editorial workflows",
        text: "Brief one",
      },
      {
        id: "summary_2",
        kind: "rss",
        label: "Daily sources",
        query: "ignored when label exists",
        text: "Brief two",
      },
    ]);

    expect(created).toEqual(added);
    expect(window.__weaveSourcesAdded).toBe(true);
    expect(added).toEqual([
      { name: "Web search: local-first editorial workflows", text: "Brief one" },
      { name: "Daily sources", text: "Brief two" },
    ]);
    expect(removed).toEqual(["summary_1", "summary_2"]);
  });

  it("keeps Weave intake flag untouched when there is nothing to send", () => {
    const window = loadBrowserGather({
      addWeaveSource: vi.fn(),
    });

    expect((window.GATHER as any).sendGatherItemsToWeave([])).toEqual([]);
    expect(window.__weaveSourcesAdded).toBeUndefined();
  });
});
