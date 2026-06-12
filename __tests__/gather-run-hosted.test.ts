import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("POST /api/gather/run hosted queueing", () => {
  it("queues a hosted Gather background job instead of running connectors inline", async () => {
    const enqueueBackgroundJob = vi.fn(async () => ({
      id: "job_1",
      kind: "gather_run",
      status: "queued",
      campaignId: "campaign_1",
      runAfter: new Date("2026-06-11T00:00:00.000Z"),
    }));
    const runGatherForCampaign = vi.fn();
    const reserveUsage = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/tenant", () => ({
      campaignInWorkspace: vi.fn(async () => true),
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));
    vi.doMock("@/lib/jobs/background", () => ({ enqueueBackgroundJob }));
    vi.doMock("@/lib/gather/runCampaign", () => ({ runGatherForCampaign }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation: vi.fn(),
      failUsageReservation: vi.fn(),
    }));
    vi.doMock("@/lib/llm", () => ({ getAIForTaskForUser: vi.fn() }));

    const { POST } = await import("../app/api/gather/run/route");
    const res = await POST(new Request("http://test.local/api/gather/run", {
      method: "POST",
      body: JSON.stringify({ campaignId: "campaign_1" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({
      queued: true,
      job: {
        id: "job_1",
        kind: "gather_run",
        status: "queued",
        campaignId: "campaign_1",
        runAfter: "2026-06-11T00:00:00.000Z",
      },
    });
    expect(enqueueBackgroundJob).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      userId: "user_1",
      campaignId: "campaign_1",
      kind: "gather_run",
      maxAttempts: 3,
      payload: { campaignId: "campaign_1", requestedBy: "manual" },
    }));
    const calls = enqueueBackgroundJob.mock.calls as unknown as Array<[{ idempotencyKey?: string }]>;
    const enqueued = calls[0]?.[0];
    expect(String(enqueued.idempotencyKey)).toMatch(/^gather:manual:campaign_1:user_1:/);
    expect(runGatherForCampaign).not.toHaveBeenCalled();
    expect(reserveUsage).not.toHaveBeenCalled();
  });

  it("keeps local-first Gather runs synchronous", async () => {
    const runGatherForCampaign = vi.fn(async () => ({
      items: [],
      found: 2,
      saved: 1,
      perSource: { source_1: 2 },
      summaries: [{ sourceId: "source_1", text: "Summary" }],
    }));
    const reserveUsage = vi.fn(async () => ({ id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "k" }));
    const completeUsageReservation = vi.fn();
    const enqueueBackgroundJob = vi.fn();
    const ai = {};

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/tenant", () => ({
      campaignInWorkspace: vi.fn(async () => true),
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));
    vi.doMock("@/lib/jobs/background", () => ({ enqueueBackgroundJob }));
    vi.doMock("@/lib/gather/runCampaign", () => ({ runGatherForCampaign }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation,
      failUsageReservation: vi.fn(),
    }));
    vi.doMock("@/lib/llm", () => ({
      getAIForTaskForUser: vi.fn(async () => ({
        ai,
        providerSource: "managed",
        provider: "anthropic",
        model: "claude-haiku-4-5",
      })),
    }));

    const { POST } = await import("../app/api/gather/run/route");
    const res = await POST(new Request("http://test.local/api/gather/run", {
      method: "POST",
      body: JSON.stringify({ campaignId: "campaign_1" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      items: [],
      found: 2,
      saved: 1,
      perSource: { source_1: 2 },
      summaries: [{ sourceId: "source_1", text: "Summary" }],
    });
    expect(enqueueBackgroundJob).not.toHaveBeenCalled();
    expect(runGatherForCampaign).toHaveBeenCalledWith("campaign_1", {
      id: "user_1",
      workspaceId: "workspace_1",
      role: "author",
    }, ai);
    expect(completeUsageReservation).toHaveBeenCalled();
  });
});

describe("GET /api/gather/run/[jobId]", () => {
  it("returns only the current user's scoped Gather background job", async () => {
    const job = {
      id: "job_1",
      kind: "gather_run",
      status: "succeeded",
      campaignId: "campaign_1",
      attempts: 1,
      maxAttempts: 3,
      runAfter: new Date("2026-06-11T00:00:00.000Z"),
      result: { found: 2, saved: 1 },
      errorCode: null,
      errorMessage: null,
      createdAt: new Date("2026-06-11T00:00:00.000Z"),
      updatedAt: new Date("2026-06-11T00:01:00.000Z"),
      completedAt: new Date("2026-06-11T00:01:00.000Z"),
    };
    const findFirst = vi.fn(async () => job);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/db/schema");
      return {
        ...actual,
        db: { query: { backgroundJobs: { findFirst } } },
      };
    });

    const { GET } = await import("../app/api/gather/run/[jobId]/route");
    const res = await GET(new Request("http://test.local/api/gather/run/job_1"), {
      params: Promise.resolve({ jobId: "job_1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(findFirst).toHaveBeenCalled();
    expect(body).toEqual({
      job: {
        id: "job_1",
        kind: "gather_run",
        status: "succeeded",
        campaignId: "campaign_1",
        attempts: 1,
        maxAttempts: 3,
        runAfter: "2026-06-11T00:00:00.000Z",
        result: { found: 2, saved: 1 },
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-06-11T00:00:00.000Z",
        updatedAt: "2026-06-11T00:01:00.000Z",
        completedAt: "2026-06-11T00:01:00.000Z",
      },
    });
  });
});
