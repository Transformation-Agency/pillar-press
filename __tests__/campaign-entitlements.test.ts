import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hosted campaign entitlement limits", () => {
  it("blocks campaign capacity when the current plan limit is reached", async () => {
    class MockBillingError extends Error {
      status: number;
      code: string;
      constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
      }
    }
    const subscription = { workspaceId: "workspace_1", planId: "trial", status: "trialing", trialEnd: null };
    const entitlement = { planId: "trial", maxCampaigns: 2 };
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
          where: vi.fn(async () => [{ id: "campaign_1" }, { id: "campaign_2" }]),
        }),
      });

    vi.doMock("@/lib/billing/stripe", () => ({
      BillingError: MockBillingError,
      getLatestSubscription: vi.fn(async () => subscription),
      getOrCreateTrialSubscription: vi.fn(),
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      billingAccessForSubscription: vi.fn(() => ({ allowed: true })),
    }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select } };
    });

    const { requireCampaignCapacity } = await import("@/lib/billing/entitlements");

    await expect(requireCampaignCapacity({
      id: "user_1",
      workspaceId: "workspace_1",
      role: "author",
    })).rejects.toMatchObject({
      status: 402,
      code: "campaign_limit_exceeded",
    });
  });

  it("checks hosted campaign capacity before inserting a new campaign", async () => {
    const { BillingError } = await import("@/lib/billing/stripe");
    const error = new BillingError(
      402,
      "campaign_limit_exceeded",
      "Campaign limit reached for your plan (2). Upgrade to create more campaigns.",
    );
    const requireCampaignCapacity = vi.fn(async () => {
      throw error;
    });
    const insert = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireCampaignCapacity }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { insert } };
    });

    const { POST } = await import("../app/api/campaigns/route");
    const res = await POST(new Request("http://test.local/api/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "Third campaign" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "Campaign limit reached for your plan (2). Upgrade to create more campaigns.",
      code: "campaign_limit_exceeded",
    });
    expect(requireCampaignCapacity).toHaveBeenCalledWith({
      id: "user_1",
      workspaceId: "workspace_1",
      role: "author",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not check hosted campaign capacity in local-first mode", async () => {
    const requireCampaignCapacity = vi.fn();
    const createLocalCampaign = vi.fn(() => ({
      id: "local_campaign_1",
      workspaceId: "local_workspace",
      name: "Local campaign",
    }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local_user", workspaceId: "local_workspace", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/local/database", () => ({
      createLocalCampaign,
      listLocalCampaigns: vi.fn(),
    }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireCampaignCapacity }));

    const { POST } = await import("../app/api/campaigns/route");
    const res = await POST(new Request("http://test.local/api/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "Local campaign" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({
      campaign: {
        id: "local_campaign_1",
        workspaceId: "local_workspace",
        name: "Local campaign",
      },
    });
    expect(requireCampaignCapacity).not.toHaveBeenCalled();
  });
});
