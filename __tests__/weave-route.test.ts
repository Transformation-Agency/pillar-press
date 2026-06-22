import { beforeEach, describe, expect, it, vi } from "vitest";

function request(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("POST /api/weave", () => {
  it("runs synchronous weave through the selected task model and records usage", async () => {
    const result = {
      extracts: [{ name: "A", summary: "summary" }],
      brief: {
        workingTitle: "Woven Draft",
        concept: "concept",
        coreMessage: "message",
        thread: "thread",
        tensions: [],
        structure: [{ section: "Open", purpose: "Start" }],
      },
      mapping: { mapped: [], nearestAngle: null, audience: "", register: "essay" },
      draft: "Generated draft",
      generatedAt: 12345,
    };
    const ai = { complete: vi.fn(), json: vi.fn(), text: vi.fn() };
    const getAIForTaskForUser = vi.fn(async () => ({
      ai,
      providerSource: "local",
      provider: "ollama",
      model: "gemma3:latest",
      profileId: "ollama-local",
    }));
    const runWeave = vi.fn(async () => result);
    const reservation = { id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "weave-k" };
    const reserveUsage = vi.fn(async () => reservation);
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/llm", () => ({ getAIForTaskForUser }));
    vi.doMock("@/lib/weave", () => ({ runWeave }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation,
      failUsageReservation,
    }));
    vi.doMock("@/lib/db", () => ({
      db: { query: { campaigns: { findFirst: vi.fn() }, references: { findFirst: vi.fn() } } },
      campaigns: {},
      references: {},
    }));

    const { POST } = await import("../app/api/weave/route");
    const sources = [
      { name: "A", text: "This first source has enough content for weaving." },
      { name: "B", text: "This second source also has enough content for weaving." },
      { name: "C", text: "This third source has enough content for estimated credits." },
    ];
    const res = await POST(request("http://test.local/api/weave", { sources }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(result);
    expect(getAIForTaskForUser).toHaveBeenCalledWith("weave", {
      id: "user_1",
      workspaceId: "workspace_1",
      role: "author",
    });
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "weave",
      feature: "weave.run",
      providerSource: "local",
      provider: "ollama",
      model: "gemma3:latest",
      estimatedCredits: 3,
      metadata: {
        sourceCount: 3,
        async: false,
        profileId: "ollama-local",
      },
    }));
    expect(runWeave).toHaveBeenCalledWith(sources, "", ai);
    expect(completeUsageReservation).toHaveBeenCalledWith(reservation, { actualCredits: 3 });
    expect(failUsageReservation).not.toHaveBeenCalled();
  });

  it("returns a clean 400 before reserving usage when fewer than two sources have content", async () => {
    const reserveUsage = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation: vi.fn(),
      failUsageReservation: vi.fn(),
    }));
    vi.doMock("@/lib/db", () => ({
      db: { query: { campaigns: { findFirst: vi.fn() }, references: { findFirst: vi.fn() } } },
      campaigns: {},
      references: {},
    }));

    const { POST } = await import("../app/api/weave/route");
    const res = await POST(request("http://test.local/api/weave", {
      sources: [
        { name: "A", text: "short" },
        { name: "B", text: "This source has enough content for weaving." },
      ],
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Add at least two sources with content to weave.",
      code: "bad_request",
    });
    expect(reserveUsage).not.toHaveBeenCalled();
  });

  it("accepts local campaign ids and injects local references into the weave run", async () => {
    const ai = { complete: vi.fn(), json: vi.fn(), text: vi.fn() };
    const getAIForTaskForUser = vi.fn(async () => ({
      ai,
      providerSource: "local",
      provider: "ollama",
      model: "gemma4:26b-mlx",
    }));
    const runWeave = vi.fn(async () => ({
      extracts: [],
      brief: {},
      mapping: {},
      draft: "draft",
      generatedAt: 123,
    }));
    const reservation = { id: "usage_2", workspaceId: "local-workspace", idempotencyKey: "weave-local" };
    const reserveUsage = vi.fn(async () => reservation);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local-owner", workspaceId: "local-workspace", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/local/database", () => ({
      getLocalCampaign: vi.fn(() => ({ id: "camp_local", workspaceId: "local-workspace", name: "Local book" })),
      getLocalReferences: vi.fn(() => ({ doc: { strategy: { note: "Use the house strategy." } } })),
    }));
    vi.doMock("@/lib/refContext", () => ({
      buildRefContext: vi.fn(() => "LOCAL REF CONTEXT"),
    }));
    vi.doMock("@/lib/llm", () => ({ getAIForTaskForUser }));
    vi.doMock("@/lib/weave", () => ({ runWeave }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation: vi.fn(),
      failUsageReservation: vi.fn(),
    }));
    vi.doMock("@/lib/db", () => ({
      db: { query: { campaigns: { findFirst: vi.fn() }, references: { findFirst: vi.fn() } } },
      campaigns: {},
      references: {},
    }));

    const { POST } = await import("../app/api/weave/route");
    const sources = [
      { name: "A", text: "This first source has enough content for weaving." },
      { name: "B", text: "This second source also has enough content for weaving." },
    ];
    const res = await POST(request("http://test.local/api/weave", { sources, campaignId: "camp_local" }));

    expect(res.status).toBe(200);
    expect(runWeave).toHaveBeenCalledWith(sources, "LOCAL REF CONTEXT", ai);
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: "camp_local",
      provider: "ollama",
      model: "gemma4:26b-mlx",
    }));
  });
});
