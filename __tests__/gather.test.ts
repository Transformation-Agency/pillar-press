/** Connector tests (vitest). Mock fetch so no network/keys are needed; assert
 *  each connector returns the documented item shape with demo:false, and that
 *  runGather tolerates a failing source. */
import { describe, it, expect, vi, afterEach } from "vitest";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Demo News</title>
<item><title>AI &amp; teams</title><link>https://ex.com/a</link><description>&lt;p&gt;Snippet one.&lt;/p&gt;</description><pubDate>Mon, 05 May 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

function mockFetch(body: string, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, text: async () => body, json: async () => JSON.parse(body) }) as any);
}
afterEach(() => vi.restoreAllMocks());

describe("rss connector", () => {
  it("parses RSS into the item shape (demo:false, html stripped)", async () => {
    global.fetch = mockFetch(RSS) as any;
    const { runRss } = await import("../lib/gather/rss");
    const items = await runRss("https://ex.com/feed.xml");
    expect(items[0]).toMatchObject({ kind: "rss", title: "AI & teams", url: "https://ex.com/a", demo: false, source: "Demo News" });
    expect(items[0].snippet).toBe("Snippet one.");
    expect(items[0].date).toBe("2026-05-05");
  });
});

describe("runGather", () => {
  it("skips a failing source and keeps the rest", async () => {
    const { runGather } = await import("../lib/gather");
    const sources = [
      { id: "s1", kind: "rss" as const, config: "https://ex.com/feed.xml", enabled: true },
      { id: "s2", kind: "rss" as const, config: "", enabled: true }, // skipped (no config)
    ];
    global.fetch = mockFetch(RSS) as any;
    const { items, perSource } = await runGather(sources);
    expect(items.length).toBeGreaterThan(0);
    expect(perSource.s1).toBeGreaterThan(0);
  });
});

describe("websearch connector", () => {
  it("throws a config error (not a leak) when the provider key is missing", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    const { runWebSearch } = await import("../lib/gather/websearch");
    await expect(runWebSearch("test")).rejects.toMatchObject({ code: "config" });
  });
});
