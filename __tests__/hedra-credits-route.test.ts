import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Hedra credits route in hosted mode", () => {
  it("reports managed Hedra availability without exposing platform credits", async () => {
    const getCredits = vi.fn();
    const requireManagedProviderAccess = vi.fn(async () => ({}));

    vi.stubEnv("HEDRA_API_KEY", "platform-hedra-key");
    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/hedra", () => ({ getCredits }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      requireManagedProviderAccess,
      requireByokProviderAccess: vi.fn(),
    }));
    vi.doMock("@/lib/tenant", () => ({
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));

    const { GET } = await import("../app/api/hedra/credits/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, configured: true, managed: true, credits: null });
    expect(requireManagedProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(getCredits).not.toHaveBeenCalled();
  });

  it("checks BYOK Hedra credits only after BYOK provider access is allowed", async () => {
    const getCredits = vi.fn(async () => ({ remaining: 42 }));
    const requireByokProviderAccess = vi.fn(async () => ({}));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/hedra", () => ({ getCredits }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      requireManagedProviderAccess: vi.fn(),
      requireByokProviderAccess,
    }));
    vi.doMock("@/lib/tenant", () => ({
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));

    const { POST } = await import("../app/api/hedra/credits/route");
    const res = await POST(new Request("http://test.local/api/hedra/credits", {
      method: "POST",
      body: JSON.stringify({ apiKey: "user-hedra-key" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, configured: true, credits: { remaining: 42 } });
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(getCredits).toHaveBeenCalledWith({ apiKey: "user-hedra-key" });
  });
});
