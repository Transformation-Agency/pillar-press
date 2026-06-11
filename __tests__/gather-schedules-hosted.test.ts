import { beforeEach, describe, expect, it, vi } from "vitest";

function request(url: string, body?: unknown) {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hosted Gather schedules", () => {
  it("returns 404 when listing schedules for an out-of-workspace campaign", async () => {
    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/tenant", () => ({
      campaignInWorkspace: vi.fn(async () => false),
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));

    const { GET } = await import("../app/api/gather/schedules/route");
    const res = await GET(request("http://test.local/api/gather/schedules?campaignId=campaign_elsewhere"));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Not found.", code: "not_found" });
  });

  it("lists hosted schedules from Postgres for the scoped campaign", async () => {
    const schedules = [{ id: "schedule_1", userId: "user_1", workspaceId: "workspace_1", campaignId: "campaign_1" }];
    const orderBy = vi.fn(async () => schedules);
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    vi.doMock("@/lib/db", () => ({ db: { select } }));
    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/tenant", () => ({
      campaignInWorkspace: vi.fn(async () => true),
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));

    const { GET } = await import("../app/api/gather/schedules/route");
    const res = await GET(request("http://test.local/api/gather/schedules?campaignId=campaign_1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ schedules });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("creates hosted schedules in the caller workspace", async () => {
    const schedule = {
      id: "schedule_1",
      userId: "user_1",
      workspaceId: "workspace_1",
      campaignId: "campaign_1",
      cadence: "daily",
      timeOfDay: "08:00",
      enabled: true,
    };
    const returning = vi.fn(async () => [schedule]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const select = vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: vi.fn(async () => []),
        }),
      }),
    }));

    vi.doMock("@/lib/db", () => ({ db: { insert, select } }));
    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/tenant", () => ({
      campaignInWorkspace: vi.fn(async () => true),
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));

    const { POST } = await import("../app/api/gather/schedules/route");
    const res = await POST(request("http://test.local/api/gather/schedules", {
      campaignId: "campaign_1",
      cadence: "daily",
      timeOfDay: "08:00",
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ schedule });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      workspaceId: "workspace_1",
      campaignId: "campaign_1",
      cadence: "daily",
    }));
  });

  it("runs due hosted schedules and marks one-time schedules disabled", async () => {
    const schedule = {
      id: "schedule_1",
      userId: "user_1",
      workspaceId: "workspace_1",
      campaignId: "campaign_1",
      cadence: "once",
      runAt: "2000-01-01T00:00:00.000Z",
      timeOfDay: null,
      dayOfWeek: null,
      enabled: true,
      lastRunAt: null,
    };
    const orderBy = vi.fn(async () => [schedule]);
    const updateWhere = vi.fn(async () => ({ rowCount: 1 }));
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const db = {
      select: vi.fn(() => ({ from: () => ({ where: () => ({ orderBy }) }) })),
      update,
    };
    const runGatherForCampaign = vi.fn(async () => ({ found: 2, saved: 1 }));
    const gatherAI = { complete: vi.fn(), json: vi.fn() };
    const reserveUsage = vi.fn(async () => ({ id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "k" }));
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();

    vi.doMock("@/lib/db", () => ({ db }));
    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/gather/runCampaign", () => ({ runGatherForCampaign }));
    vi.doMock("@/lib/llm", () => ({
      getAIForTaskForUser: vi.fn(async () => ({
        ai: gatherAI,
        providerSource: "byok",
        provider: "openai",
        model: "gpt-4o-mini",
        profileId: "openai-gather",
      })),
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation,
      failUsageReservation,
    }));

    const { POST } = await import("../app/api/gather/schedules/run-due/route");
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ran: 1,
      results: [{ id: "schedule_1", campaignId: "campaign_1", status: "ok", found: 2, saved: 1 }],
    });
    expect(runGatherForCampaign).toHaveBeenCalledWith("campaign_1", {
      id: "user_1",
      workspaceId: "workspace_1",
      role: "author",
    }, gatherAI);
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "gather",
      feature: "gather.schedule.run_due",
      campaignId: "campaign_1",
      providerSource: "byok",
      provider: "openai",
      model: "gpt-4o-mini",
      metadata: {
        scheduleId: "schedule_1",
        providerSource: "byok",
        profileId: "openai-gather",
      },
    }));
    expect(completeUsageReservation).toHaveBeenCalledWith(
      { id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "k" },
      {
        actualCredits: 1,
        metadata: {
          scheduleId: "schedule_1",
          providerSource: "byok",
          profileId: "openai-gather",
          found: 2,
          saved: 1,
        },
      },
    );
    expect(failUsageReservation).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      lastStatus: "ok",
      enabled: false,
    }));
  });
});
