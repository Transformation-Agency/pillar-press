import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hosted usage reservations", () => {
  it("maps tasks to the correct quota dimensions and billing period", async () => {
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));

    const {
      periodForSubscription,
      quotaErrorMessage,
      usageDimensionForTask,
    } = await import("@/lib/billing/usage");

    expect(usageDimensionForTask("media_generation")).toBe("media");
    expect(usageDimensionForTask("gather")).toBe("gather");
    expect(usageDimensionForTask("review")).toBe("llm");
    expect(quotaErrorMessage("gather")).toContain("Gather");

    const period = periodForSubscription({
      currentPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
    } as any);
    expect(period).toEqual({
      start: new Date("2026-06-01T00:00:00.000Z"),
      end: new Date("2026-07-01T00:00:00.000Z"),
    });
  });

  it("bypasses reservations in local-first desktop mode", async () => {
    const insert = vi.fn();
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { insert } };
    });

    const { reserveUsage } = await import("@/lib/billing/usage");

    await expect(reserveUsage({
      user: { id: "local-user", workspaceId: "local-workspace", role: "author" },
      task: "utility",
      feature: "test",
    })).resolves.toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it("blocks hosted work before inserting a reservation when quota is exceeded", async () => {
    class MockBillingError extends Error {
      status: number;
      code: string;
      constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
      }
    }
    const insert = vi.fn();
    const entitlement = {
      planId: "trial",
      monthlyLlmCredits: 10,
      monthlyMediaGenerations: 1,
      monthlyGatherRuns: 1,
    };
    const subscription = {
      workspaceId: "workspace_1",
      planId: "trial",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2026-06-08T00:00:00.000Z"),
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn(async () => [entitlement]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: vi.fn(async () => [
            { status: "succeeded", estimatedCredits: 1, actualCredits: 10 },
          ]),
        }),
      });

    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/auth", () => ({ getOrCreateWorkspace: vi.fn() }));
    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: MockBillingError,
      getLatestSubscription: vi.fn(async () => subscription),
      getOrCreateTrialSubscription: vi.fn(),
    }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select, insert } };
    });

    const { reserveUsage } = await import("@/lib/billing/usage");

    await expect(reserveUsage({
      user: { id: "user_1", workspaceId: "workspace_1", role: "author" },
      task: "utility",
      feature: "llm.util.utility",
      estimatedCredits: 1,
    })).rejects.toMatchObject({ status: 402, code: "quota_exceeded" });
    expect(insert).not.toHaveBeenCalled();
  });
});
