import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hosted background jobs", () => {
  it("redacts secret-like payload and result keys recursively", async () => {
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/db/schema");
      return { ...actual, db: {} };
    });
    const { sanitizeJobData } = await import("@/lib/jobs/background");

    expect(sanitizeJobData({
      prompt: "Run gather",
      apiKey: "sk-secret",
      nested: {
        accessToken: "token-secret",
        safe: "visible",
      },
      files: [{ password: "nope", name: "brief.md" }],
    })).toEqual({
      prompt: "Run gather",
      apiKey: "[redacted]",
      nested: {
        accessToken: "[redacted]",
        safe: "visible",
      },
      files: [{ password: "[redacted]", name: "brief.md" }],
    });
  });

  it("does not enqueue hosted jobs in local-first mode", async () => {
    const insert = vi.fn();
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/db/schema");
      return { ...actual, db: { insert } };
    });

    const { enqueueBackgroundJob } = await import("@/lib/jobs/background");
    const job = await enqueueBackgroundJob({
      workspaceId: "workspace_1",
      kind: "gather_run",
      payload: { apiKey: "sk-secret" },
    });

    expect(job).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it("enqueues idempotent hosted jobs without persisting raw secrets", async () => {
    const returning = vi.fn(async () => [{ id: "job_1", status: "queued" }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));

    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/db/schema");
      return { ...actual, db: { insert } };
    });

    const { enqueueBackgroundJob } = await import("@/lib/jobs/background");
    const job = await enqueueBackgroundJob({
      workspaceId: "workspace_1",
      userId: "user_1",
      kind: "gather_run",
      idempotencyKey: "gather:campaign_1",
      payload: { campaignId: "campaign_1", apiKey: "sk-secret" },
    });

    expect(job).toEqual({ id: "job_1", status: "queued" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      userId: "user_1",
      kind: "gather_run",
      status: "queued",
      idempotencyKey: "gather:campaign_1",
      payload: { campaignId: "campaign_1", apiKey: "[redacted]" },
    }));
    expect(onConflictDoUpdate).toHaveBeenCalled();
    expect(JSON.stringify(values.mock.calls)).not.toContain("sk-secret");
  });

  it("claims the next queued hosted job and marks it processing", async () => {
    const candidate = {
      id: "job_1",
      kind: "gather_run",
      status: "queued",
      attempts: 1,
      maxAttempts: 3,
    };
    const limit = vi.fn(async () => [candidate]);
    const orderBy = vi.fn(() => ({ limit }));
    const whereSelect = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where: whereSelect }));
    const select = vi.fn(() => ({ from }));
    const returning = vi.fn(async () => [{ ...candidate, status: "processing", attempts: 2, lockedBy: "worker_1" }]);
    const whereUpdate = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where: whereUpdate }));
    const update = vi.fn(() => ({ set }));

    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/db/schema");
      return { ...actual, db: { select, update } };
    });

    const { claimNextBackgroundJob } = await import("@/lib/jobs/background");
    const job = await claimNextBackgroundJob({
      workerId: "worker_1",
      kinds: ["gather_run"],
      now: new Date("2026-06-11T00:00:00.000Z"),
    });

    expect(job).toEqual({ ...candidate, status: "processing", attempts: 2, lockedBy: "worker_1" });
    expect(select).toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "processing",
      lockedBy: "worker_1",
      attempts: 2,
      errorCode: null,
      errorMessage: null,
    }));
  });
});

describe("hosted background job runner", () => {
  it("runs a queued Gather job with usage reservation and secret-free completion", async () => {
    const job = {
      id: "job_1",
      workspaceId: "workspace_1",
      userId: "user_1",
      campaignId: "campaign_1",
      pieceId: null,
      kind: "gather_run",
      status: "processing",
      priority: 0,
      runAfter: new Date(),
      lockedBy: "worker_1",
      lockedAt: new Date(),
      attempts: 1,
      maxAttempts: 3,
      idempotencyKey: "gather:campaign_1",
      payload: { campaignId: "campaign_1" },
      result: {},
      errorCode: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
    };
    const claimNextBackgroundJob = vi.fn(async () => job);
    const completeBackgroundJob = vi.fn(async () => ({ ...job, status: "succeeded" }));
    const failBackgroundJob = vi.fn();
    const reserveUsage = vi.fn(async () => ({ id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "background:job_1:gather" }));
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();
    const ai = {};
    const getAIForTaskForUser = vi.fn(async () => ({
      ai,
      providerSource: "byok",
      provider: "openai",
      model: "gpt-4o-mini",
      profileId: "profile_1",
    }));
    const runGatherForCampaign = vi.fn(async () => ({
      found: 5,
      saved: 2,
      perSource: { source_1: 5 },
      summaries: [{ sourceId: "source_1", text: "Summary" }],
    }));

    vi.doMock("@/lib/jobs/background", () => ({
      claimNextBackgroundJob,
      completeBackgroundJob,
      failBackgroundJob,
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation,
      failUsageReservation,
    }));
    vi.doMock("@/lib/llm", () => ({ getAIForTaskForUser }));
    vi.doMock("@/lib/gather/runCampaign", () => ({ runGatherForCampaign }));

    const { runNextBackgroundJob } = await import("@/lib/jobs/runner");
    const result = await runNextBackgroundJob({ workerId: "worker_1" });

    expect(result).toEqual({
      claimed: true,
      jobId: "job_1",
      kind: "gather_run",
      status: "succeeded",
      result: {
        found: 5,
        saved: 2,
        sourceCount: 1,
        summaryCount: 1,
      },
    });
    expect(claimNextBackgroundJob).toHaveBeenCalledWith({ workerId: "worker_1", kinds: ["gather_run"] });
    expect(getAIForTaskForUser).toHaveBeenCalledWith("gather", { id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "gather",
      feature: "jobs.gather_run",
      campaignId: "campaign_1",
      idempotencyKey: "background:job_1:gather",
      providerSource: "byok",
      provider: "openai",
      model: "gpt-4o-mini",
      metadata: { backgroundJobId: "job_1", profileId: "profile_1" },
    }));
    expect(runGatherForCampaign).toHaveBeenCalledWith("campaign_1", { id: "user_1", workspaceId: "workspace_1", role: "author" }, ai);
    expect(completeUsageReservation).toHaveBeenCalledWith(
      { id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "background:job_1:gather" },
      { actualCredits: 1, metadata: { backgroundJobId: "job_1", found: 5, saved: 2 } },
    );
    expect(completeBackgroundJob).toHaveBeenCalledWith(job, {
      found: 5,
      saved: 2,
      sourceCount: 1,
      summaryCount: 1,
    });
    expect(failUsageReservation).not.toHaveBeenCalled();
    expect(failBackgroundJob).not.toHaveBeenCalled();
  });

  it("fails or requeues the job when Gather processing fails", async () => {
    const job = {
      id: "job_1",
      workspaceId: "workspace_1",
      userId: "user_1",
      campaignId: "campaign_1",
      pieceId: null,
      kind: "gather_run",
      status: "processing",
      priority: 0,
      runAfter: new Date(),
      lockedBy: "worker_1",
      lockedAt: new Date(),
      attempts: 1,
      maxAttempts: 3,
      idempotencyKey: "gather:campaign_1",
      payload: {},
      result: {},
      errorCode: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
    };
    const error = new Error("Provider unavailable");
    const claimNextBackgroundJob = vi.fn(async () => job);
    const failBackgroundJob = vi.fn(async () => ({ ...job, status: "queued", errorMessage: error.message }));
    const reserveUsage = vi.fn(async () => ({ id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "background:job_1:gather" }));
    const failUsageReservation = vi.fn();

    vi.doMock("@/lib/jobs/background", () => ({
      claimNextBackgroundJob,
      completeBackgroundJob: vi.fn(),
      failBackgroundJob,
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation: vi.fn(),
      failUsageReservation,
    }));
    vi.doMock("@/lib/llm", () => ({
      getAIForTaskForUser: vi.fn(async () => ({
        ai: {},
        providerSource: "managed",
        provider: "anthropic",
        model: "claude-haiku-4-5",
      })),
    }));
    vi.doMock("@/lib/gather/runCampaign", () => ({
      runGatherForCampaign: vi.fn(async () => { throw error; }),
    }));

    const { runNextBackgroundJob } = await import("@/lib/jobs/runner");
    const result = await runNextBackgroundJob({ workerId: "worker_1" });

    expect(result).toMatchObject({
      claimed: true,
      jobId: "job_1",
      status: "requeued",
      error: "Provider unavailable",
    });
    expect(failUsageReservation).toHaveBeenCalledWith(
      { id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "background:job_1:gather" },
      error,
    );
    expect(failBackgroundJob).toHaveBeenCalledWith(job, error);
  });
});
