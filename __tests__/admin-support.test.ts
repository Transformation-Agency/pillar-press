import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.KINGS_PRESS_ADMIN_SECRET;
  delete process.env.KINGS_PRESS_SUPPORT_SECRET;
});

describe("GET /api/admin/support/workspaces", () => {
  it("requires a configured admin support secret", async () => {
    const execute = vi.fn();
    vi.doMock("@/lib/db", () => ({ db: { execute } }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent: vi.fn() }));

    const { GET } = await import("../app/api/admin/support/workspaces/route");
    const res = await GET(new Request("http://test.local/api/admin/support/workspaces"));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({
      error: "Admin support tools are not configured.",
      code: "admin_not_configured",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong admin secret", async () => {
    process.env.KINGS_PRESS_ADMIN_SECRET = "admin-secret";
    const execute = vi.fn();
    vi.doMock("@/lib/db", () => ({ db: { execute } }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent: vi.fn() }));

    const { GET } = await import("../app/api/admin/support/workspaces/route");
    const res = await GET(new Request("http://test.local/api/admin/support/workspaces", {
      headers: { Authorization: "Bearer wrong" },
    }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized.", code: "unauthorized" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("lists workspace support snapshots without secrets or emails", async () => {
    process.env.KINGS_PRESS_ADMIN_SECRET = "admin-secret";
    const safeRecordAuditEvent = vi.fn();
    const execute = vi.fn(async () => ({
      rows: [{
        workspaceId: "workspace_1",
        workspaceName: "Private user@example.com desk",
        planId: "pro",
        subscriptionStatus: "active",
        llmProfileCount: 2,
        mediaProfileCount: 1,
        queuedJobCount: 0,
        processingJobCount: 1,
        failedUsageEventCount: 3,
        quotaBlockEventCount: 1,
        lastUsageAt: "2026-06-12T10:00:00.000Z",
      }],
    }));
    vi.doMock("@/lib/db", () => ({ db: { execute } }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));

    const { GET } = await import("../app/api/admin/support/workspaces/route");
    const res = await GET(new Request("http://test.local/api/admin/support/workspaces?limit=5", {
      headers: { "x-kings-press-admin-secret": "admin-secret" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.workspaces).toEqual([expect.objectContaining({
      workspaceId: "workspace_1",
      workspaceName: "Private [redacted-email] desk",
      planId: "pro",
      subscriptionStatus: "active",
      llmProfileCount: 2,
      mediaProfileCount: 1,
      failedUsageEventCount: 3,
      quotaBlockEventCount: 1,
      lastUsageAt: "2026-06-12T10:00:00.000Z",
    })]);
    expect(JSON.stringify(body)).not.toContain("user@example.com");
    expect(JSON.stringify(body)).not.toContain("sk-");
    expect(safeRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorType: "admin",
      action: "admin.support_workspaces.listed",
      targetType: "workspaces",
      metadata: { limit: 5 },
    }));
  });

  it("returns a detailed workspace support view with scrubbed metadata", async () => {
    process.env.KINGS_PRESS_SUPPORT_SECRET = "support-secret";
    const safeRecordAuditEvent = vi.fn();
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          workspaceId: "workspace_1",
          workspaceName: "Workspace",
          planId: "trial",
          subscriptionStatus: "trialing",
          llmProfileCount: 1,
          mediaProfileCount: 0,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ llmCreditsUsed: 3, costUsd: "0.001000" }] })
      .mockResolvedValueOnce({ rows: [{ task: "chat", status: "failed", errorCode: "llm" }] })
      .mockResolvedValueOnce({
        rows: [{
          event: "started",
          metadata: {
            source: "test",
            apiKey: "sk-secret",
            email: "private@example.com",
          },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          actorType: "user",
          action: "provider_settings.updated",
          metadata: {
            Authorization: "Bearer sk-secret",
            nested: { password: "hunter2" },
          },
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "job_1", kind: "gather_run", status: "queued" }] })
      .mockResolvedValueOnce({
        rows: [{
          task: "chat",
          status: "failed",
          errorCode: "quota_exceeded",
          eventCount: 2,
          lastSeenAt: "2026-06-12T10:00:00.000Z",
        }],
      });
    vi.doMock("@/lib/db", () => ({ db: { execute } }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));

    const { GET } = await import("../app/api/admin/support/workspaces/route");
    const res = await GET(new Request("http://test.local/api/admin/support/workspaces?workspaceId=workspace_1", {
      headers: { Authorization: "Bearer support-secret" },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.workspace).toMatchObject({
      workspaceId: "workspace_1",
      planId: "trial",
      subscriptionStatus: "trialing",
    });
    expect(body.usageRollups).toEqual([{ llmCreditsUsed: 3, costUsd: "0.001000" }]);
    expect(body.backgroundJobs).toEqual([{ id: "job_1", kind: "gather_run", status: "queued" }]);
    expect(body.usageDiagnostics).toEqual([{
      task: "chat",
      status: "failed",
      errorCode: "quota_exceeded",
      eventCount: 2,
      lastSeenAt: "2026-06-12T10:00:00.000Z",
    }]);
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(JSON.stringify(body)).not.toContain("private@example.com");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).toContain("[redacted]");
    expect(safeRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      actorType: "admin",
      action: "admin.support_workspace.viewed",
      targetType: "workspace",
      targetId: "workspace_1",
    }));
  });
});

describe("POST /api/admin/support/trials/extend", () => {
  it("requires the admin mutation secret", async () => {
    const getLatestSubscription = vi.fn();
    vi.doMock("@/lib/billing/stripe", async () => {
      const actual = await vi.importActual<any>("@/lib/billing/stripe");
      return { ...actual, getLatestSubscription };
    });
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { update: vi.fn(), insert: vi.fn() } };
    });
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent: vi.fn() }));

    const { POST } = await import("../app/api/admin/support/trials/extend/route");
    const res = await POST(new Request("http://test.local/api/admin/support/trials/extend", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace_1", days: 7 }),
    }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({
      error: "Admin mutation tools are not configured.",
      code: "admin_not_configured",
    });
    expect(getLatestSubscription).not.toHaveBeenCalled();
  });

  it("does not allow the read-only support secret to extend trials", async () => {
    process.env.KINGS_PRESS_SUPPORT_SECRET = "support-secret";
    process.env.KINGS_PRESS_ADMIN_SECRET = "admin-secret";
    const getLatestSubscription = vi.fn();
    vi.doMock("@/lib/billing/stripe", async () => {
      const actual = await vi.importActual<any>("@/lib/billing/stripe");
      return { ...actual, getLatestSubscription };
    });
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { update: vi.fn(), insert: vi.fn() } };
    });
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent: vi.fn() }));

    const { POST } = await import("../app/api/admin/support/trials/extend/route");
    const res = await POST(new Request("http://test.local/api/admin/support/trials/extend", {
      method: "POST",
      headers: { Authorization: "Bearer support-secret" },
      body: JSON.stringify({ workspaceId: "workspace_1", days: 7 }),
    }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({
      error: "Admin access is required.",
      code: "admin_required",
    });
    expect(getLatestSubscription).not.toHaveBeenCalled();
  });

  it("extends a trial subscription and records trial/audit events without secrets", async () => {
    process.env.KINGS_PRESS_ADMIN_SECRET = "admin-secret";
    vi.setSystemTime(new Date("2026-06-12T12:00:00Z"));
    const subscription = {
      id: "sub_trial",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-01T00:00:00Z"),
      trialEnd: new Date("2026-06-15T00:00:00Z"),
      currentPeriodEnd: new Date("2026-06-15T00:00:00Z"),
      metadata: { source: "hosted_signup_trial" },
    };
    const getLatestSubscription = vi.fn(async () => subscription);
    const returning = vi.fn(async () => [{
      ...subscription,
      trialEnd: new Date("2026-06-22T00:00:00Z"),
      currentPeriodEnd: new Date("2026-06-22T00:00:00Z"),
    }]);
    const whereUpdate = vi.fn(() => ({ returning }));
    const setUpdate = vi.fn(() => ({ where: whereUpdate }));
    const update = vi.fn(() => ({ set: setUpdate }));
    const valuesInsert = vi.fn(async () => undefined);
    const insert = vi.fn(() => ({ values: valuesInsert }));
    const safeRecordAuditEvent = vi.fn();

    vi.doMock("@/lib/billing/stripe", async () => {
      const actual = await vi.importActual<any>("@/lib/billing/stripe");
      return { ...actual, getLatestSubscription };
    });
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { update, insert } };
    });
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));

    const { POST } = await import("../app/api/admin/support/trials/extend/route");
    const res = await POST(new Request("http://test.local/api/admin/support/trials/extend", {
      method: "POST",
      headers: { Authorization: "Bearer admin-secret" },
      body: JSON.stringify({
        workspaceId: "workspace_1",
        days: 7,
        reason: "Customer asked from private@example.com with sk-secret in notes.",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getLatestSubscription).toHaveBeenCalledWith("workspace_1");
    expect(setUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: "trialing",
      trialEnd: new Date("2026-06-22T00:00:00Z"),
      currentPeriodEnd: new Date("2026-06-22T00:00:00Z"),
    }));
    expect(valuesInsert).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      event: "extended",
      planId: "trial",
      trialEnd: new Date("2026-06-22T00:00:00Z"),
      metadata: expect.objectContaining({
        source: "admin_support",
        days: 7,
        subscriptionId: "sub_trial",
      }),
    }));
    expect(safeRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      actorType: "admin",
      action: "admin.trial.extended",
      targetType: "subscription",
      targetId: "sub_trial",
      metadata: expect.objectContaining({
        days: 7,
        trialEnd: "2026-06-22T00:00:00.000Z",
      }),
    }));
    expect(body.subscription).toMatchObject({
      id: "sub_trial",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialEnd: "2026-06-22T00:00:00.000Z",
    });
    expect(JSON.stringify(valuesInsert.mock.calls)).not.toContain("private@example.com");
    expect(JSON.stringify(valuesInsert.mock.calls)).not.toContain("sk-secret");
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("private@example.com");
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("sk-secret");
    expect(JSON.stringify(body)).not.toContain("private@example.com");
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    vi.useRealTimers();
  });

  it("does not extend a paid subscription", async () => {
    process.env.KINGS_PRESS_ADMIN_SECRET = "admin-secret";
    const getLatestSubscription = vi.fn(async () => ({
      id: "sub_paid",
      workspaceId: "workspace_1",
      planId: "pro",
      status: "active",
    }));
    const update = vi.fn();
    const insert = vi.fn();
    vi.doMock("@/lib/billing/stripe", async () => {
      const actual = await vi.importActual<any>("@/lib/billing/stripe");
      return { ...actual, getLatestSubscription };
    });
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { update, insert } };
    });
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent: vi.fn() }));

    const { POST } = await import("../app/api/admin/support/trials/extend/route");
    const res = await POST(new Request("http://test.local/api/admin/support/trials/extend", {
      method: "POST",
      headers: { "x-kings-press-admin-secret": "admin-secret" },
      body: JSON.stringify({ workspaceId: "workspace_1", days: 7 }),
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "Only trial subscriptions can be extended from support tools.",
      code: "not_trial_subscription",
    });
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
