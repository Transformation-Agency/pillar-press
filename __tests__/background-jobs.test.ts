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
