import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("tenant scoping helpers", () => {
  it("rejects missing campaign or workspace ids without touching storage", async () => {
    const findFirst = vi.fn();
    vi.doMock("@/lib/local/mode", () => ({
      isLocalFirstMode: () => false,
    }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return {
        ...actual,
        db: { query: { campaigns: { findFirst } } },
      };
    });

    const { campaignInWorkspace } = await import("@/lib/tenant");

    await expect(campaignInWorkspace(null, "workspace_1")).resolves.toBe(false);
    await expect(campaignInWorkspace("campaign_1", null)).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("uses the hosted campaign lookup for hosted workspace scope", async () => {
    const findFirst = vi.fn(async () => ({ id: "campaign_1" }));
    vi.doMock("@/lib/local/mode", () => ({
      isLocalFirstMode: () => false,
    }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return {
        ...actual,
        db: { query: { campaigns: { findFirst } } },
      };
    });

    const { campaignInWorkspace } = await import("@/lib/tenant");

    await expect(campaignInWorkspace("campaign_1", "workspace_1")).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("uses the local campaign lookup in local-first mode", async () => {
    const getLocalCampaign = vi.fn(() => ({ id: "campaign_1" }));
    vi.doMock("@/lib/local/mode", () => ({
      isLocalFirstMode: () => true,
    }));
    vi.doMock("@/lib/local/database", () => ({
      getLocalCampaign,
    }));

    const { campaignInWorkspace } = await import("@/lib/tenant");

    await expect(campaignInWorkspace("campaign_1", "local-workspace")).resolves.toBe(true);
    expect(getLocalCampaign).toHaveBeenCalledWith("campaign_1", "local-workspace");
  });
});
