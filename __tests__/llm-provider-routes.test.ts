import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted LLM provider utility routes", () => {
  it("requires BYOK provider access before testing a hosted LLM profile", async () => {
    const getHostedProviderProfile = vi.fn();
    const createAIFromConfig = vi.fn();
    const requireByokProviderAccess = vi.fn(async () => {
      const { BillingError } = await import("@/lib/billing/stripe");
      throw new BillingError(402, "byok_provider_not_enabled", "Bring-your-own-key provider usage is not included in your current plan.");
    });

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile }));
    vi.doMock("@/lib/llm", async () => {
      const actual = await vi.importActual<any>("@/lib/llm");
      return { ...actual, createAIFromConfig };
    });

    const { POST } = await import("../app/api/llm/test/route");
    const res = await POST(new Request("http://test.local/api/llm/test", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        profileId: "openai-main",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "Bring-your-own-key provider usage is not included in your current plan.",
      code: "byok_provider_not_enabled",
    });
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(getHostedProviderProfile).not.toHaveBeenCalled();
    expect(createAIFromConfig).not.toHaveBeenCalled();
  });

  it("requires BYOK provider access before listing hosted LLM models", async () => {
    const getHostedProviderProfile = vi.fn();
    const fetch = vi.fn();
    const requireByokProviderAccess = vi.fn(async () => {
      const { BillingError } = await import("@/lib/billing/stripe");
      throw new BillingError(402, "byok_provider_not_enabled", "Bring-your-own-key provider usage is not included in your current plan.");
    });
    vi.stubGlobal("fetch", fetch);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile }));

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        profileId: "openai-main",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "Bring-your-own-key provider usage is not included in your current plan.",
      code: "byok_provider_not_enabled",
    });
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(getHostedProviderProfile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
