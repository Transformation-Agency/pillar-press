import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  campaignInWorkspace: vi.fn(),
  listLocalGatherSources: vi.fn(),
  existingLocalGatherItemUrls: vi.fn(),
  createLocalGatherItem: vi.fn(),
  updateLocalGatherSource: vi.fn(),
  getLocalReferences: vi.fn(),
  runGather: vi.fn(),
  craftSourceSummary: vi.fn(),
}));

vi.mock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
vi.mock("@/lib/tenant", () => ({ campaignInWorkspace: mock.campaignInWorkspace }));
vi.mock("@/lib/local/database", () => ({
  listLocalGatherSources: mock.listLocalGatherSources,
  existingLocalGatherItemUrls: mock.existingLocalGatherItemUrls,
  createLocalGatherItem: mock.createLocalGatherItem,
  updateLocalGatherSource: mock.updateLocalGatherSource,
  getLocalReferences: mock.getLocalReferences,
}));
vi.mock("@/lib/gather", () => ({ runGather: mock.runGather }));
vi.mock("@/lib/ai/gatherSummary", () => ({ craftSourceSummary: mock.craftSourceSummary }));
vi.mock("@/lib/llm", () => ({ getAIForTask: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    query: { references: { findFirst: vi.fn() } },
  },
  references: {},
}));
vi.mock("@/db/gather-schema", () => ({
  gatherSources: {},
  gatherItems: {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.campaignInWorkspace.mockResolvedValue(true);
  mock.listLocalGatherSources.mockReturnValue([
    { id: "source_1", kind: "rss", config: "https://example.com/feed.xml", enabled: true, label: "Example feed" },
    { id: "source_2", kind: "web", config: "agentic writing", enabled: true, label: "Search" },
  ]);
  mock.existingLocalGatherItemUrls.mockReturnValue(new Set(["https://example.com/old"]));
  mock.createLocalGatherItem.mockImplementation((input) => ({ id: `item_${input.url.split("/").pop()}`, ...input }));
  mock.getLocalReferences.mockReturnValue({ doc: { strategy: { body: "Prefer grounded, practical framing." } } });
  mock.runGather.mockResolvedValue({
    perSource: { source_1: 2, source_2: 1 },
    items: [
      {
        kind: "rss",
        sourceId: "source_1",
        title: "Old item",
        source: "Example",
        url: "https://example.com/old",
        snippet: "Already saved",
        demo: false,
      },
      {
        kind: "rss",
        sourceId: "source_1",
        title: "New item",
        source: "Example",
        url: "https://example.com/new",
        snippet: "Fresh",
        demo: false,
      },
      {
        kind: "web",
        sourceId: "source_2",
        title: "Search hit",
        source: "Web",
        url: "https://search.example/hit",
        snippet: "Result",
        demo: false,
      },
    ],
  });
  mock.craftSourceSummary.mockImplementation(async ({ label, items }) => {
    const count = Array.isArray(items) ? items.length : 0;
    return `${label}: ${count} useful item${count === 1 ? "" : "s"}.`;
  });
});

describe("runGatherForCampaign local-first", () => {
  it("persists fresh gather items, updates source counts, and stores source summaries", async () => {
    const ai = { text: vi.fn() };
    const { runGatherForCampaign } = await import("../lib/gather/runCampaign");

    const result = await runGatherForCampaign("campaign_1", {
      id: "local_user",
      workspaceId: "local_workspace",
    }, ai as any);

    expect(result).toMatchObject({
      found: 3,
      saved: 2,
      perSource: { source_1: 2, source_2: 1 },
    });
    expect(result?.items.map((item: any) => item.url)).toEqual([
      "https://example.com/new",
      "https://search.example/hit",
    ]);
    expect(mock.createLocalGatherItem).toHaveBeenCalledTimes(2);
    expect(mock.createLocalGatherItem).not.toHaveBeenCalledWith(expect.objectContaining({ url: "https://example.com/old" }), expect.anything(), expect.anything());
    expect(mock.updateLocalGatherSource).toHaveBeenCalledWith("source_1", "local_user", expect.objectContaining({
      lastCount: 2,
    }));
    expect(mock.updateLocalGatherSource).toHaveBeenCalledWith("source_2", "local_user", expect.objectContaining({
      lastCount: 1,
    }));
    expect(mock.craftSourceSummary).toHaveBeenCalledWith(expect.objectContaining({
      kindLabel: "RSS / News feed",
      label: "Example feed",
      items: expect.arrayContaining([
        expect.objectContaining({ title: "Old item" }),
        expect.objectContaining({ title: "New item" }),
      ]),
      refContext: expect.stringContaining("Strategy note"),
    }), ai);
    expect(mock.updateLocalGatherSource).toHaveBeenCalledWith("source_1", "local_user", expect.objectContaining({
      summary: "Example feed: 2 useful items.",
      summaryItemCount: 2,
    }));
    expect(result?.summaries).toEqual([
      expect.objectContaining({ sourceId: "source_1", text: "Example feed: 2 useful items.", itemCount: 2 }),
      expect.objectContaining({ sourceId: "source_2", text: "Search: 1 useful item.", itemCount: 1 }),
    ]);
  });

  it("returns null before connector work when the campaign is outside the workspace", async () => {
    mock.campaignInWorkspace.mockResolvedValueOnce(false);
    const { runGatherForCampaign } = await import("../lib/gather/runCampaign");

    await expect(runGatherForCampaign("missing_campaign", { id: "local_user", workspaceId: "local_workspace" })).resolves.toBeNull();
    expect(mock.listLocalGatherSources).not.toHaveBeenCalled();
    expect(mock.runGather).not.toHaveBeenCalled();
  });
});
