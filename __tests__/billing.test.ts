import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: vi.fn(() => false) }));
  delete process.env.STRIPE_PRICE_PRO;
});

class TestBillingError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BillingError";
    this.status = status;
    this.code = code;
  }
}

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

  it("records paid subscription webhook conversions without requiring checkout session context", async () => {
    const inserted: unknown[] = [];
    const values = vi.fn((row: unknown) => {
      inserted.push(row);
      return {};
    });
    const insert = vi.fn(() => ({ values }));
    const limit = vi.fn(async () => []);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select, insert } };
    });

    const { recordTrialConversionForSubscription } = await import("@/lib/billing/stripe");

    await recordTrialConversionForSubscription({
      subscription: {
        id: "local_sub_1",
        workspaceId: "workspace_1",
        planId: "pro",
        status: "active",
        stripeSubscriptionId: "sub_123",
        trialStart: new Date("2026-06-01T00:00:00.000Z"),
        trialEnd: new Date("2026-06-08T00:00:00.000Z"),
      } as any,
      userId: "user_1",
      source: "customer.subscription.updated",
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      userId: "user_1",
      event: "converted",
      planId: "pro",
      metadata: {
        source: "customer.subscription.updated",
        stripeSessionId: null,
        stripeSubscriptionId: "sub_123",
        localSubscriptionId: "local_sub_1",
      },
    }));
    expect(JSON.stringify(inserted)).not.toContain("@");
  });

  it("does not record trial or inactive subscription webhook conversions", async () => {
    const values = vi.fn();
    const insert = vi.fn(() => ({ values }));
    const limit = vi.fn(async () => []);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select, insert } };
    });

    const { recordTrialConversionForSubscription } = await import("@/lib/billing/stripe");

    await recordTrialConversionForSubscription({
      subscription: {
        id: "local_sub_trial",
        workspaceId: "workspace_1",
        planId: "trial",
        status: "trialing",
      } as any,
      source: "customer.subscription.updated",
    });
    await recordTrialConversionForSubscription({
      subscription: {
        id: "local_sub_inactive",
        workspaceId: "workspace_1",
        planId: "pro",
        status: "past_due",
      } as any,
      source: "customer.subscription.updated",
    });

    expect(insert).not.toHaveBeenCalled();
  });
});

describe("hosted billing status API", () => {
  it("returns local desktop billing status without hosted Stripe dependencies", async () => {
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: vi.fn(() => true) }));

    const { GET } = await import("../app/api/billing/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      plans: [{
        id: "local-desktop",
        name: "Local Desktop",
        stripeConfigured: false,
      }],
      subscription: {
        id: "local-desktop",
        planId: "local-desktop",
        status: "active",
      },
      access: { allowed: true },
      lifecycle: {
        planId: "local-desktop",
        status: "active",
        primaryAction: "none",
        upgradeRecommended: false,
      },
    });
    expect(body.usage.dimensions).toMatchObject({
      llm: { used: 0, limit: 0, remaining: 0 },
      gather: { used: 0, limit: 0, remaining: 0 },
      media: { used: 0, limit: 0, remaining: 0 },
      storage: { used: 0, limit: 0, remaining: 0 },
    });
    expect(JSON.stringify(body)).not.toContain("sk_");
    expect(JSON.stringify(body)).not.toContain("whsec_");
  });

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
      safeRecordTrialEndingReminderEvent: vi.fn(),
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
      safeRecordTrialEndingReminderEvent: vi.fn(),
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

  it("records an ending reminder event when billing status detects a trial ending soon", async () => {
    const user = { id: "user_1", workspaceId: "workspace_1", role: "author" };
    const subscription = {
      id: "sub_trial",
      workspaceId: "workspace_1",
      planId: "trial",
      status: "trialing",
      trialStart: new Date("2026-06-01T00:00:00.000Z"),
      trialEnd: new Date("2026-06-13T00:00:00.000Z"),
    };
    const safeRecordTrialEndingReminderEvent = vi.fn();
    const safeRecordTrialExpirationEvent = vi.fn();

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
        primaryAction: "choose_plan",
        upgradeRecommended: true,
        trial: {
          startedAt: new Date("2026-06-01T00:00:00.000Z"),
          endsAt: new Date("2026-06-13T00:00:00.000Z"),
          daysRemaining: 2,
          expired: false,
          endsSoon: true,
        },
      })),
      getEntitlementForPlan: vi.fn(async () => ({ planId: "trial" })),
      safeRecordTrialEndingReminderEvent,
      safeRecordTrialExpirationEvent,
      usageSummaryForSubscription: vi.fn(async () => ({
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-06-13T00:00:00.000Z",
        dimensions: {},
      })),
    }));

    const { GET } = await import("../app/api/billing/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.lifecycle.trial.endsSoon).toBe(true);
    expect(safeRecordTrialEndingReminderEvent).toHaveBeenCalledWith({
      user,
      subscription,
      source: "billing_status",
      daysRemaining: 2,
    });
    expect(safeRecordTrialExpirationEvent).not.toHaveBeenCalled();
  });
});

describe("hosted billing session audit events", () => {
  it("returns readable local desktop errors instead of starting checkout or portal sessions", async () => {
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: vi.fn(() => true) }));
    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: TestBillingError,
      appBaseUrl: vi.fn(() => "http://test.local"),
      getLatestSubscription: vi.fn(),
      getOrCreateBillingCustomer: vi.fn(),
      getStripe: vi.fn(),
      requireBillingUser: vi.fn(),
      requireCheckoutPlan: vi.fn(),
    }));

    const checkoutRoute = await import("../app/api/billing/checkout/route");
    const portalRoute = await import("../app/api/billing/portal/route");

    const checkout = await checkoutRoute.POST(new Request("http://test.local/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ planId: "pro" }),
    }));
    const checkoutBody = await checkout.json();
    const portal = await portalRoute.POST(new Request("http://test.local/api/billing/portal", {
      method: "POST",
      body: "{}",
    }));
    const portalBody = await portal.json();

    expect(checkout.status).toBe(409);
    expect(checkoutBody).toEqual({
      error: "Hosted Stripe checkout is not available in local desktop mode.",
      code: "billing_unavailable_local_desktop",
    });
    expect(portal.status).toBe(409);
    expect(portalBody).toEqual({
      error: "Hosted Stripe customer portal is not available in local desktop mode.",
      code: "billing_unavailable_local_desktop",
    });
  });

  it("records sanitized audit metadata when creating a Checkout session", async () => {
    const createCheckout = vi.fn(async () => ({ id: "cs_123", url: "https://checkout.stripe.test/session" }));
    const getOrCreateBillingCustomer = vi.fn(async () => ({
      stripeCustomerId: "cus_123",
    }));
    const safeRecordAuditEvent = vi.fn();

    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));
    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: TestBillingError,
      requireBillingUser: vi.fn(async () => ({
        id: "user_1",
        workspaceId: "workspace_1",
        role: "author",
        email: "private@example.com",
      })),
      requireCheckoutPlan: vi.fn(async () => ({
        plan: { id: "pro" },
        priceId: "price_pro",
      })),
      getLatestSubscription: vi.fn(async () => ({
        planId: "trial",
        status: "trialing",
        stripeSubscriptionId: null,
      })),
      getOrCreateBillingCustomer,
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
      body: JSON.stringify({ planId: "pro", email: "attacker@example.com" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ url: "https://checkout.stripe.test/session" });
    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      mode: "subscription",
      customer: "cus_123",
      line_items: [{ price: "price_pro", quantity: 1 }],
    }));
    expect(getOrCreateBillingCustomer).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      userId: "user_1",
      email: "private@example.com",
    });
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
    expect(JSON.stringify(getOrCreateBillingCustomer.mock.calls)).not.toContain("attacker@example.com");
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("attacker@example.com");
  });

  it("does not create a duplicate Checkout session for the active current plan", async () => {
    const createCheckout = vi.fn(async () => ({ id: "cs_123", url: "https://checkout.stripe.test/session" }));

    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent: vi.fn() }));
    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: TestBillingError,
      requireBillingUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
      requireCheckoutPlan: vi.fn(async () => ({
        plan: { id: "pro" },
        priceId: "price_pro",
      })),
      getLatestSubscription: vi.fn(async () => ({
        planId: "pro",
        status: "active",
        stripeSubscriptionId: "sub_123",
      })),
      getOrCreateBillingCustomer: vi.fn(async () => {
        throw new Error("customer should not be created");
      }),
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
      body: JSON.stringify({ planId: "pro" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "You are already on this plan.",
      code: "plan_already_active",
    });
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("sends active paid subscribers to the billing portal for plan changes", async () => {
    const createCheckout = vi.fn(async () => ({ id: "cs_123", url: "https://checkout.stripe.test/session" }));

    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent: vi.fn() }));
    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: TestBillingError,
      requireBillingUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
      requireCheckoutPlan: vi.fn(async () => ({
        plan: { id: "team" },
        priceId: "price_team",
      })),
      getLatestSubscription: vi.fn(async () => ({
        planId: "pro",
        status: "active",
        stripeSubscriptionId: "sub_123",
      })),
      getOrCreateBillingCustomer: vi.fn(async () => {
        throw new Error("customer should not be created");
      }),
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
      body: JSON.stringify({ planId: "team" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "Manage billing to change your plan.",
      code: "billing_portal_required",
    });
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("records sanitized audit metadata when creating a Customer Portal session", async () => {
    const createPortal = vi.fn(async () => ({ id: "bps_123", url: "https://billing.stripe.test/session" }));
    const getOrCreateBillingCustomer = vi.fn(async () => ({
      stripeCustomerId: "cus_123",
    }));
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
      requireBillingUser: vi.fn(async () => ({
        id: "user_1",
        workspaceId: "workspace_1",
        role: "author",
        email: "private@example.com",
      })),
      getOrCreateBillingCustomer,
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
      body: JSON.stringify({ email: "attacker@example.com" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ url: "https://billing.stripe.test/session" });
    expect(createPortal).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://kingspress.test/?billing=portal-return",
    });
    expect(getOrCreateBillingCustomer).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      userId: "user_1",
      email: "private@example.com",
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
    expect(JSON.stringify(getOrCreateBillingCustomer.mock.calls)).not.toContain("attacker@example.com");
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("attacker@example.com");
  });
});
