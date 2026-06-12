import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hosted usage reservations", () => {
  it("maps tasks to the correct quota dimensions and billing period", async () => {
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));

    const {
      billingAccessForSubscription,
      entitlementAllowsByokProvider,
      entitlementAllowsManagedProvider,
      periodForSubscription,
      quotaErrorMessage,
      storageQuotaBytes,
      subscriptionAllowsUsage,
      trialExpirationEventValues,
      usageDimensionForTask,
    } = await import("@/lib/billing/usage");

    expect(usageDimensionForTask("media_generation")).toBe("media");
    expect(usageDimensionForTask("gather")).toBe("gather");
    expect(usageDimensionForTask("review")).toBe("llm");
    expect(quotaErrorMessage("gather")).toContain("Gather");
    expect(subscriptionAllowsUsage("trialing")).toBe(true);
    expect(subscriptionAllowsUsage("active")).toBe(true);
    expect(subscriptionAllowsUsage("past_due")).toBe(false);
    expect(subscriptionAllowsUsage("canceled")).toBe(false);
    expect(entitlementAllowsManagedProvider({ allowedProviders: ["managed", "byok"], canUseManagedKeys: true } as any)).toBe(true);
    expect(entitlementAllowsManagedProvider({ allowedProviders: ["byok"], canUseManagedKeys: true } as any)).toBe(false);
    expect(entitlementAllowsManagedProvider({ allowedProviders: ["managed"], canUseManagedKeys: false } as any)).toBe(false);
    expect(entitlementAllowsByokProvider({ allowedProviders: ["byok"] } as any)).toBe(true);
    expect(entitlementAllowsByokProvider({ allowedProviders: ["managed"] } as any)).toBe(false);
    expect(storageQuotaBytes({ storageQuotaGb: 2 } as any)).toBe(2n * 1024n * 1024n * 1024n);
    expect(trialExpirationEventValues({
      user: { id: "user_1" },
      subscription: {
        id: "sub_trial",
        workspaceId: "workspace_1",
        planId: "trial",
        trialStart: new Date("2026-06-01T00:00:00.000Z"),
        trialEnd: new Date("2026-06-08T00:00:00.000Z"),
      } as any,
      source: "billing_status",
    })).toEqual({
      workspaceId: "workspace_1",
      userId: "user_1",
      event: "expired",
      planId: "trial",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2026-06-08T00:00:00.000Z"),
      metadata: {
        source: "billing_status",
        localSubscriptionId: "sub_trial",
      },
    });
    expect(billingAccessForSubscription(null)).toMatchObject({ allowed: false, code: "subscription_required" });
    expect(billingAccessForSubscription({
      status: "trialing",
      trialEnd: new Date("2026-06-10T00:00:00.000Z"),
    } as any, new Date("2026-06-11T00:00:00.000Z"))).toMatchObject({
      allowed: false,
      code: "trial_expired",
    });
    expect(billingAccessForSubscription({
      status: "trialing",
      trialEnd: new Date("2026-06-12T00:00:00.000Z"),
    } as any, new Date("2026-06-11T00:00:00.000Z"))).toEqual({ allowed: true });

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
      allowedProviders: ["managed", "byok"],
      canUseManagedKeys: true,
      monthlyLlmCredits: 10,
      monthlyMediaGenerations: 1,
      monthlyGatherRuns: 1,
    };
    const subscription = {
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2099-06-08T00:00:00.000Z"),
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

  it("blocks hosted work before inserting a reservation when subscription is inactive", async () => {
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
    const select = vi.fn();
    const subscription = {
      workspaceId: "workspace_1",
      planId: "pro",
      status: "canceled",
      currentPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
    };

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
    })).rejects.toMatchObject({ status: 402, code: "subscription_inactive" });
    expect(select).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("blocks hosted work before inserting a reservation when the free trial has expired", async () => {
    class MockBillingError extends Error {
      status: number;
      code: string;
      constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
      }
    }
    const inserted: Array<Record<string, unknown>> = [];
    const values = vi.fn((value) => {
      inserted.push(value);
      return {};
    });
    const insert = vi.fn(() => ({ values }));
    const select = vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: vi.fn(async () => []),
        }),
      }),
    }));
    const subscription = {
      id: "sub_trial",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2026-06-08T00:00:00.000Z"),
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };

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
    })).rejects.toMatchObject({ status: 402, code: "trial_expired" });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      userId: "user_1",
      event: "expired",
      planId: "trial",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2026-06-08T00:00:00.000Z"),
      metadata: {
        source: "usage.utility",
        localSubscriptionId: "sub_trial",
      },
    }));
    expect(JSON.stringify(inserted)).not.toContain("private@example.com");
  });

  it("blocks hosted managed provider work before inserting when plan disallows managed keys", async () => {
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
      allowedProviders: ["byok"],
      canUseManagedKeys: false,
      monthlyLlmCredits: 250,
      monthlyMediaGenerations: 5,
      monthlyGatherRuns: 10,
    };
    const subscription = {
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2099-06-08T00:00:00.000Z"),
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
    const select = vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn(async () => [entitlement]),
        }),
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
    })).rejects.toMatchObject({ status: 402, code: "managed_provider_not_enabled" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("allows hosted BYOK reservations when managed keys are disabled but BYOK is allowed", async () => {
    const entitlement = {
      planId: "starter",
      allowedProviders: ["byok"],
      canUseManagedKeys: false,
      monthlyLlmCredits: 250,
      monthlyMediaGenerations: 5,
      monthlyGatherRuns: 10,
    };
    const subscription = {
      workspaceId: "workspace_1",
      planId: "starter",
      status: "active",
      currentPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
    };
    const returning = vi.fn(async () => [{ id: "usage_1" }]);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const insert = vi.fn(() => ({ values }));
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
          where: vi.fn(async () => []),
        }),
      });

    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/auth", () => ({ getOrCreateWorkspace: vi.fn() }));
    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: class BillingError extends Error {
        status: number;
        code: string;
        constructor(status: number, code: string, message: string) {
          super(message);
          this.status = status;
          this.code = code;
        }
      },
      getLatestSubscription: vi.fn(async () => subscription),
      getOrCreateTrialSubscription: vi.fn(),
    }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select, insert } };
    });

    const { reserveUsage } = await import("@/lib/billing/usage");
    const reservation = await reserveUsage({
      user: { id: "user_1", workspaceId: "workspace_1", role: "author" },
      task: "utility",
      feature: "llm.util.utility",
      providerSource: "byok",
      provider: "openai",
      model: "gpt-4o-mini",
      metadata: { profileId: "openai-gpt" },
      estimatedCredits: 1,
    });

    expect(reservation).toEqual({ id: "usage_1", workspaceId: "workspace_1", idempotencyKey: expect.any(String) });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      model: "gpt-4o-mini",
      metadata: expect.objectContaining({ providerSource: "byok", profileId: "openai-gpt" }),
    }));
  });

  it("blocks hosted BYOK reservations when the plan disallows BYOK providers", async () => {
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
      allowedProviders: ["managed"],
      canUseManagedKeys: true,
      monthlyLlmCredits: 250,
      monthlyMediaGenerations: 5,
      monthlyGatherRuns: 10,
    };
    const subscription = {
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2099-06-08T00:00:00.000Z"),
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
    const select = vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn(async () => [entitlement]),
        }),
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
      providerSource: "byok",
      estimatedCredits: 1,
    })).rejects.toMatchObject({ status: 402, code: "byok_provider_not_enabled" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("blocks hosted storage before incrementing rollups when quota is exceeded", async () => {
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
      storageQuotaGb: 1,
    };
    const subscription = {
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2099-06-08T00:00:00.000Z"),
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
    const almostFull = (1024n * 1024n * 1024n - 10n).toString();
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
          where: () => ({
            limit: vi.fn(async () => [{ storageBytesUsed: almostFull }]),
          }),
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

    const { reserveStorageBytes } = await import("@/lib/billing/usage");

    await expect(reserveStorageBytes({
      user: { id: "user_1", workspaceId: "workspace_1", role: "author" },
      bytes: 20,
      feature: "storage.image",
    })).rejects.toMatchObject({ status: 402, code: "storage_quota_exceeded" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("increments and releases hosted storage reservations", async () => {
    const entitlement = {
      planId: "trial",
      storageQuotaGb: 1,
    };
    const subscription = {
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2099-06-08T00:00:00.000Z"),
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };
    const updateWhere = vi.fn(async () => undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
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
          where: () => ({
            limit: vi.fn(async () => [{ storageBytesUsed: "100" }]),
          }),
        }),
      });

    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/auth", () => ({ getOrCreateWorkspace: vi.fn() }));
    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: class BillingError extends Error {
        status: number;
        code: string;
        constructor(status: number, code: string, message: string) {
          super(message);
          this.status = status;
          this.code = code;
        }
      },
      getLatestSubscription: vi.fn(async () => subscription),
      getOrCreateTrialSubscription: vi.fn(),
    }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select, insert, update } };
    });

    const { reserveStorageBytes, releaseStorageReservation } = await import("@/lib/billing/usage");

    const reservation = await reserveStorageBytes({
      user: { id: "user_1", workspaceId: "workspace_1", role: "author" },
      bytes: 512,
      feature: "storage.image",
    });
    expect(reservation).toMatchObject({ workspaceId: "workspace_1", bytes: 512 });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      storageBytesUsed: "512",
    }));
    expect(onConflictDoUpdate).toHaveBeenCalled();

    await releaseStorageReservation(reservation);
    expect(update).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: expect.any(Date) }));
    expect(updateWhere).toHaveBeenCalled();
  });

  it("rebuilds current-period usage rollups from the usage event ledger", async () => {
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({
          where: vi.fn(async () => [
            {
              task: "chat",
              status: "succeeded",
              estimatedCredits: 2,
              actualCredits: 4,
              estimatedCostUsd: "0.001000",
              actualCostUsd: "0.003000",
            },
            {
              task: "outputs",
              status: "reserved",
              estimatedCredits: 3,
              actualCredits: 0,
              estimatedCostUsd: "0.002000",
              actualCostUsd: null,
            },
            {
              task: "media_generation",
              status: "succeeded",
              estimatedCredits: 1,
              actualCredits: 1,
              estimatedCostUsd: "0.004000",
              actualCostUsd: "0.005000",
            },
            {
              task: "gather",
              status: "succeeded",
              estimatedCredits: 1,
              actualCredits: 2,
              estimatedCostUsd: "0.002000",
              actualCostUsd: "0.006000",
            },
          ]),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn(async () => [{ storageBytesUsed: "2048" }]),
          }),
        }),
      });

    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select, insert } };
    });

    const { usageSummaryForSubscription } = await import("@/lib/billing/usage");

    const summary = await usageSummaryForSubscription({
      workspaceId: "workspace_1",
      subscription: {
        workspaceId: "workspace_1",
        planId: "trial",
        status: "trialing",
        currentPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
      } as any,
      entitlement: {
        monthlyLlmCredits: 250,
        monthlyMediaGenerations: 5,
        monthlyGatherRuns: 10,
        storageQuotaGb: 1,
      } as any,
    });

    expect(summary.dimensions.llm).toEqual({ used: 7, limit: 250, remaining: 243 });
    expect(summary.dimensions.media).toEqual({ used: 1, limit: 5, remaining: 4 });
    expect(summary.dimensions.gather).toEqual({ used: 2, limit: 10, remaining: 8 });
    expect(summary.dimensions.storage.used).toBe(2048);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      llmCreditsUsed: 7,
      mediaGenerationsUsed: 1,
      gatherRunsUsed: 2,
      storageBytesUsed: "2048",
      costUsd: "0.016000",
    }));
    expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      set: expect.objectContaining({
        llmCreditsUsed: 7,
        mediaGenerationsUsed: 1,
        gatherRunsUsed: 2,
        storageBytesUsed: "2048",
        costUsd: "0.016000",
      }),
    }));
  });
});

describe("billing error responses", () => {
  it("returns quota errors as client-visible 402 responses", async () => {
    const { BillingError } = await import("@/lib/billing/stripe");
    const { toErrorResponse } = await import("@/lib/errors");

    const res = toErrorResponse(new BillingError(402, "quota_exceeded", "AI usage limit reached for this billing period."));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "AI usage limit reached for this billing period.",
      code: "quota_exceeded",
    });
  });

  it("returns inactive subscription errors as client-visible 402 responses", async () => {
    const { BillingError } = await import("@/lib/billing/stripe");
    const { toErrorResponse } = await import("@/lib/errors");

    const res = toErrorResponse(new BillingError(
      402,
      "subscription_inactive",
      "Your subscription is not active. Manage billing or choose a plan to continue.",
    ));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "Your subscription is not active. Manage billing or choose a plan to continue.",
      code: "subscription_inactive",
    });
  });

  it("returns expired trial errors as client-visible 402 responses", async () => {
    const { BillingError } = await import("@/lib/billing/stripe");
    const { toErrorResponse } = await import("@/lib/errors");

    const res = toErrorResponse(new BillingError(
      402,
      "trial_expired",
      "Your free trial has ended. Choose a plan to continue.",
    ));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "Your free trial has ended. Choose a plan to continue.",
      code: "trial_expired",
    });
  });

  it("returns managed provider entitlement errors as client-visible 402 responses", async () => {
    const { BillingError } = await import("@/lib/billing/stripe");
    const { toErrorResponse } = await import("@/lib/errors");

    const res = toErrorResponse(new BillingError(
      402,
      "managed_provider_not_enabled",
      "Managed AI provider usage is not included in your current plan. Upgrade or connect your own provider to continue.",
    ));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "Managed AI provider usage is not included in your current plan. Upgrade or connect your own provider to continue.",
      code: "managed_provider_not_enabled",
    });
  });
});
