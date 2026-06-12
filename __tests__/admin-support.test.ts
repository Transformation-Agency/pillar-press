import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
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
      .mockResolvedValueOnce({ rows: [{ id: "job_1", kind: "gather_run", status: "queued" }] });
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
