import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.STRIPE_PRICE_PRO;
});

describe("hosted billing helpers", () => {
  it("resolves Stripe price ids from env fallbacks without exposing keys", async () => {
    process.env.STRIPE_PRICE_PRO = "price_pro_test";

    const { resolvePlanStripePriceId, stripePriceEnvName } = await import("@/lib/billing/stripe");

    expect(stripePriceEnvName("pro")).toBe("STRIPE_PRICE_PRO");
    expect(stripePriceEnvName("team annual")).toBe("STRIPE_PRICE_TEAM_ANNUAL");
    expect(resolvePlanStripePriceId({ id: "pro", stripePriceId: null })).toBe("price_pro_test");
    expect(resolvePlanStripePriceId({ id: "pro", stripePriceId: "price_db" })).toBe("price_db");
  });

  it("maps current Stripe subscription item periods into the local subscription snapshot", async () => {
    const { stripeSubscriptionSnapshot } = await import("@/lib/billing/stripe");

    const snapshot = stripeSubscriptionSnapshot({
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      trial_start: null,
      trial_end: null,
      cancel_at_period_end: false,
      canceled_at: null,
      items: {
        data: [
          {
            price: { id: "price_pro" },
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
          },
        ],
      },
    } as any);

    expect(snapshot).toMatchObject({
      stripeSubscriptionId: "sub_123",
      stripeCustomerId: "cus_123",
      stripePriceId: "price_pro",
      status: "active",
      currentPeriodStart: new Date(1_700_000_000 * 1000),
      currentPeriodEnd: new Date(1_702_592_000 * 1000),
    });
  });

  it("syncs a Stripe subscription into the workspace subscription row", async () => {
    const plan = {
      id: "pro",
      name: "Pro",
      description: null,
      stripePriceId: "price_pro",
      monthlyPriceCents: 4900,
      currency: "usd",
      trialDays: 0,
      active: true,
      sortOrder: 20,
      meta: { public: true },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const returning = vi.fn(async () => [{ id: "local_sub_1", planId: "pro" }]);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const limit = vi.fn(async () => [plan]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select, insert } };
    });
    vi.doMock("@/lib/auth", () => ({
      getOrCreateWorkspace: vi.fn(),
      requireUser: vi.fn(),
    }));

    const { syncStripeSubscription } = await import("@/lib/billing/stripe");

    await expect(syncStripeSubscription({
      id: "sub_123",
      customer: "cus_123",
      status: "active",
      trial_start: null,
      trial_end: null,
      cancel_at_period_end: true,
      canceled_at: 1_701_000_000,
      metadata: { workspaceId: "workspace_1", planId: "pro" },
      items: {
        data: [
          {
            price: { id: "price_pro" },
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
          },
        ],
      },
    } as any)).resolves.toEqual({ id: "local_sub_1", planId: "pro" });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      planId: "pro",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      stripePriceId: "price_pro",
      status: "active",
      cancelAtPeriodEnd: true,
      canceledAt: new Date(1_701_000_000 * 1000),
    }));
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("builds sanitized Stripe webhook audit rows", async () => {
    const { stripeAuditEventValues } = await import("@/lib/billing/stripe");

    const values = stripeAuditEventValues({
      event: {
        id: "evt_123",
        type: "customer.subscription.updated",
        created: 1_700_000_000,
        livemode: false,
        account: undefined,
        data: {
          object: {
            id: "sub_123",
            object: "subscription",
            customer_email: "private@example.com",
          },
        },
      },
      handled: true,
      workspaceId: "workspace_1",
      targetType: "subscription",
      targetId: "local_sub_1",
      metadata: {
        stripeSubscriptionId: "sub_123",
        status: "active",
      },
    });

    expect(values).toEqual({
      workspaceId: "workspace_1",
      actorType: "stripe",
      actorId: "stripe",
      action: "stripe.customer.subscription.updated",
      targetType: "subscription",
      targetId: "local_sub_1",
      metadata: {
        eventId: "evt_123",
        eventType: "customer.subscription.updated",
        handled: true,
        livemode: false,
        created: 1_700_000_000,
        stripeSubscriptionId: "sub_123",
        status: "active",
      },
    });
    expect(JSON.stringify(values)).not.toContain("private@example.com");
  });
});

describe("hosted billing status API", () => {
  it("returns plans, subscription, entitlement, and usage summary", async () => {
    const user = { id: "user_1", workspaceId: "workspace_1", role: "author" };
    const subscription = { id: "sub_1", workspaceId: "workspace_1", planId: "trial", status: "trialing" };
    const entitlement = { planId: "trial", monthlyLlmCredits: 250 };
    const usage = {
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      dimensions: {
        llm: { used: 4, limit: 250, remaining: 246 },
        gather: { used: 1, limit: 10, remaining: 9 },
        media: { used: 0, limit: 5, remaining: 5 },
      },
    };

    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: class BillingError extends Error {},
      requireBillingUser: vi.fn(async () => user),
      listPublicPlans: vi.fn(async () => [{ id: "starter", name: "Starter", stripeConfigured: true }]),
      getOrCreateTrialSubscription: vi.fn(async () => subscription),
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      getEntitlementForPlan: vi.fn(async () => entitlement),
      usageSummaryForSubscription: vi.fn(async () => usage),
    }));

    const { GET } = await import("../app/api/billing/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      plans: [{ id: "starter", name: "Starter", stripeConfigured: true }],
      subscription,
      entitlement,
      usage,
    });
  });
});
