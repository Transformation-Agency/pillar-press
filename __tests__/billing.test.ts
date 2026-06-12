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

  it("selects an active paid Stripe subscription over a newer bootstrap trial", async () => {
    const { selectCurrentSubscription } = await import("@/lib/billing/stripe");
    const trial = {
      id: "sub_trial",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      trialEnd: new Date("2026-06-20T00:00:00.000Z"),
      createdAt: new Date("2026-06-11T00:00:00.000Z"),
      updatedAt: new Date("2026-06-11T00:00:00.000Z"),
    };
    const paid = {
      id: "sub_pro",
      workspaceId: "workspace_1",
      planId: "pro",
      status: "active",
      stripeSubscriptionId: "sub_stripe_pro",
      currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
      trialEnd: null,
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
    };

    expect(selectCurrentSubscription([trial, paid] as any[])).toBe(paid);
  });

  it("keeps a paid billing problem visible instead of falling back to a trial row", async () => {
    const { selectCurrentSubscription } = await import("@/lib/billing/stripe");
    const trial = {
      id: "sub_trial",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      trialEnd: new Date("2026-06-20T00:00:00.000Z"),
      createdAt: new Date("2026-06-09T00:00:00.000Z"),
      updatedAt: new Date("2026-06-09T00:00:00.000Z"),
    };
    const pastDue = {
      id: "sub_pro_past_due",
      workspaceId: "workspace_1",
      planId: "pro",
      status: "past_due",
      stripeSubscriptionId: "sub_stripe_pro",
      currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
      trialEnd: null,
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z"),
    };

    expect(selectCurrentSubscription([trial, pastDue] as any[])).toBe(pastDue);
  });

  it("uses the newest trial when no Stripe-backed subscription exists", async () => {
    const { selectCurrentSubscription } = await import("@/lib/billing/stripe");
    const oldTrial = {
      id: "sub_trial_old",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      trialEnd: new Date("2026-06-12T00:00:00.000Z"),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    };
    const newTrial = {
      id: "sub_trial_new",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      trialEnd: new Date("2026-06-20T00:00:00.000Z"),
      createdAt: new Date("2026-06-02T00:00:00.000Z"),
      updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    };

    expect(selectCurrentSubscription([oldTrial, newTrial] as any[])).toBe(newTrial);
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

  it("builds sanitized trial conversion event rows", async () => {
    const { trialConversionEventValues } = await import("@/lib/billing/stripe");

    const values = trialConversionEventValues({
      workspaceId: "workspace_1",
      userId: "user_1",
      planId: "pro",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2026-06-08T00:00:00.000Z"),
      stripeSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
      localSubscriptionId: "local_sub_1",
    });

    expect(values).toEqual({
      workspaceId: "workspace_1",
      userId: "user_1",
      event: "converted",
      planId: "pro",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2026-06-08T00:00:00.000Z"),
      metadata: {
        source: "checkout.session.completed",
        stripeSessionId: "cs_123",
        stripeSubscriptionId: "sub_123",
        localSubscriptionId: "local_sub_1",
      },
    });
    expect(JSON.stringify(values)).not.toContain("private@example.com");
  });
});

describe("hosted billing status API", () => {
  it("returns plans, subscription, entitlement, and usage summary", async () => {
    const user = { id: "user_1", workspaceId: "workspace_1", role: "author" };
    const subscription = {
      id: "sub_1",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialEnd: "2099-06-08T00:00:00.000Z",
    };
    const entitlement = { planId: "trial", monthlyLlmCredits: 250 };
    const usage = {
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-08T00:00:00.000Z",
      dimensions: {
        llm: { used: 4, limit: 250, remaining: 246 },
        gather: { used: 1, limit: 10, remaining: 9 },
        media: { used: 0, limit: 5, remaining: 5 },
        storage: { used: 0, limit: 1073741824, remaining: 1073741824 },
      },
    };

    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: class BillingError extends Error {},
      requireBillingUser: vi.fn(async () => user),
      listPublicPlans: vi.fn(async () => [{ id: "starter", name: "Starter", stripeConfigured: true }]),
      getOrCreateTrialSubscription: vi.fn(async () => subscription),
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      billingAccessForSubscription: vi.fn(() => ({ allowed: true })),
      billingLifecycleForSubscription: vi.fn(() => ({
        planId: "trial",
        status: "trialing",
        accessCode: null,
        primaryAction: "none",
        upgradeRecommended: false,
        trial: {
          startedAt: null,
          endsAt: "2099-06-08T00:00:00.000Z",
          daysRemaining: 9999,
          expired: false,
          endsSoon: false,
        },
      })),
      getEntitlementForPlan: vi.fn(async () => entitlement),
      safeRecordTrialExpirationEvent: vi.fn(),
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
      access: { allowed: true },
      lifecycle: {
        planId: "trial",
        status: "trialing",
        accessCode: null,
        primaryAction: "none",
        upgradeRecommended: false,
        trial: {
          startedAt: null,
          endsAt: "2099-06-08T00:00:00.000Z",
          daysRemaining: 9999,
          expired: false,
          endsSoon: false,
        },
      },
    });
  });

  it("records an expired trial event when billing status detects trial expiration", async () => {
    const user = { id: "user_1", workspaceId: "workspace_1", role: "author" };
    const subscription = {
      id: "sub_trial",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2026-06-08T00:00:00.000Z"),
    };
    const safeRecordTrialExpirationEvent = vi.fn();

    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: class BillingError extends Error {},
      requireBillingUser: vi.fn(async () => user),
      listPublicPlans: vi.fn(async () => [{ id: "starter", name: "Starter", stripeConfigured: true }]),
      getOrCreateTrialSubscription: vi.fn(async () => subscription),
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      billingAccessForSubscription: vi.fn(() => ({
        allowed: false,
        code: "trial_expired",
        message: "Your free trial has ended. Choose a plan to continue.",
      })),
      billingLifecycleForSubscription: vi.fn(() => ({
        planId: "trial",
        status: "trialing",
        accessCode: "trial_expired",
        primaryAction: "choose_plan",
        upgradeRecommended: true,
        trial: {
          startedAt: new Date("2026-06-01T00:00:00.000Z"),
          endsAt: new Date("2026-06-08T00:00:00.000Z"),
          daysRemaining: 0,
          expired: true,
          endsSoon: false,
        },
      })),
      getEntitlementForPlan: vi.fn(async () => ({ planId: "trial" })),
      safeRecordTrialExpirationEvent,
      usageSummaryForSubscription: vi.fn(async () => ({
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-06-08T00:00:00.000Z",
        dimensions: {},
      })),
    }));

    const { GET } = await import("../app/api/billing/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.access).toEqual({
      allowed: false,
      code: "trial_expired",
      message: "Your free trial has ended. Choose a plan to continue.",
    });
    expect(safeRecordTrialExpirationEvent).toHaveBeenCalledWith({
      user,
      subscription,
      source: "billing_status",
    });
  });
});

describe("hosted billing session audit events", () => {
  it("records sanitized audit metadata when creating a Checkout session", async () => {
    const createCheckout = vi.fn(async () => ({ id: "cs_123", url: "https://checkout.stripe.test/session" }));
    const safeRecordAuditEvent = vi.fn();

    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));
    vi.doMock("@/lib/billing/stripe", () => ({
      requireBillingUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
      requireCheckoutPlan: vi.fn(async () => ({
        plan: { id: "pro" },
        priceId: "price_pro",
      })),
      getOrCreateBillingCustomer: vi.fn(async () => ({
        stripeCustomerId: "cus_123",
      })),
      appBaseUrl: vi.fn(() => "https://kingspress.test"),
      getStripe: vi.fn(() => ({
        checkout: {
          sessions: {
            create: createCheckout,
          },
        },
      })),
    }));

    const { POST } = await import("../app/api/billing/checkout/route");
    const res = await POST(new Request("https://kingspress.test/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ planId: "pro", email: "private@example.com" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ url: "https://checkout.stripe.test/session" });
    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      mode: "subscription",
      customer: "cus_123",
      line_items: [{ price: "price_pro", quantity: 1 }],
    }));
    expect(safeRecordAuditEvent).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      actorId: "user_1",
      action: "billing.checkout_session.created",
      targetType: "checkout.session",
      targetId: "cs_123",
      metadata: {
        planId: "pro",
        stripeCustomerId: "cus_123",
      },
    });
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("private@example.com");
  });

  it("records sanitized audit metadata when creating a Customer Portal session", async () => {
    const createPortal = vi.fn(async () => ({ id: "bps_123", url: "https://billing.stripe.test/session" }));
    const safeRecordAuditEvent = vi.fn();

    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));
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
      requireBillingUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
      getOrCreateBillingCustomer: vi.fn(async () => ({
        stripeCustomerId: "cus_123",
      })),
      appBaseUrl: vi.fn(() => "https://kingspress.test"),
      getStripe: vi.fn(() => ({
        billingPortal: {
          sessions: {
            create: createPortal,
          },
        },
      })),
    }));

    const { POST } = await import("../app/api/billing/portal/route");
    const res = await POST(new Request("https://kingspress.test/api/billing/portal", {
      method: "POST",
      body: JSON.stringify({ email: "private@example.com" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ url: "https://billing.stripe.test/session" });
    expect(createPortal).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://kingspress.test/?billing=portal-return",
    });
    expect(safeRecordAuditEvent).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      actorId: "user_1",
      action: "billing.portal_session.created",
      targetType: "billing_portal.session",
      targetId: "bps_123",
      metadata: {
        stripeCustomerId: "cus_123",
      },
    });
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("private@example.com");
  });
});
