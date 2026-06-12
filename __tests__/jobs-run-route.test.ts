import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.KINGS_PRESS_JOB_SECRET;
});

describe("POST /api/jobs/run", () => {
  it("requires a configured worker secret", async () => {
    const runNextBackgroundJob = vi.fn();
    const recoverStaleBackgroundJobs = vi.fn();
    vi.doMock("@/lib/jobs/runner", () => ({ runNextBackgroundJob }));
    vi.doMock("@/lib/jobs/background", () => ({ recoverStaleBackgroundJobs }));

    const { POST } = await import("../app/api/jobs/run/route");
    const res = await POST(new Request("http://test.local/api/jobs/run", {
      method: "POST",
      body: JSON.stringify({ workerId: "worker_1" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({
      error: "Background jobs are not configured.",
      code: "jobs_not_configured",
    });
    expect(runNextBackgroundJob).not.toHaveBeenCalled();
    expect(recoverStaleBackgroundJobs).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong worker secret", async () => {
    process.env.KINGS_PRESS_JOB_SECRET = "job-secret";
    const runNextBackgroundJob = vi.fn();
    const recoverStaleBackgroundJobs = vi.fn();
    vi.doMock("@/lib/jobs/runner", () => ({ runNextBackgroundJob }));
    vi.doMock("@/lib/jobs/background", () => ({ recoverStaleBackgroundJobs }));

    const { POST } = await import("../app/api/jobs/run/route");
    const res = await POST(new Request("http://test.local/api/jobs/run", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
      body: JSON.stringify({ workerId: "worker_1" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized.", code: "unauthorized" });
    expect(runNextBackgroundJob).not.toHaveBeenCalled();
    expect(recoverStaleBackgroundJobs).not.toHaveBeenCalled();
  });

  it("runs up to the requested limit when authorized", async () => {
    process.env.KINGS_PRESS_JOB_SECRET = "job-secret";
    const recoverStaleBackgroundJobs = vi.fn(async () => ({ requeued: 1, failed: 0 }));
    const runNextBackgroundJob = vi
      .fn()
      .mockResolvedValueOnce({ claimed: true, jobId: "job_1", kind: "gather_run", status: "succeeded" })
      .mockResolvedValueOnce({ claimed: false, status: "idle" });
    vi.doMock("@/lib/jobs/runner", () => ({ runNextBackgroundJob }));
    vi.doMock("@/lib/jobs/background", () => ({ recoverStaleBackgroundJobs }));

    const { POST } = await import("../app/api/jobs/run/route");
    const res = await POST(new Request("http://test.local/api/jobs/run", {
      method: "POST",
      headers: { "x-kings-press-job-secret": "job-secret" },
      body: JSON.stringify({ workerId: "worker_1", limit: 3, recoverStaleAfterSeconds: 120 }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(recoverStaleBackgroundJobs).toHaveBeenCalledWith({ staleAfterMs: 120_000, limit: 50 });
    expect(runNextBackgroundJob).toHaveBeenCalledTimes(2);
    expect(runNextBackgroundJob).toHaveBeenNthCalledWith(1, { workerId: "worker_1" });
    expect(body).toEqual({
      workerId: "worker_1",
      recovered: { requeued: 1, failed: 0 },
      processed: 1,
      results: [
        { claimed: true, jobId: "job_1", kind: "gather_run", status: "succeeded" },
        { claimed: false, status: "idle" },
      ],
    });
  });
});
