import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hosted provider catalog routes", () => {
  it("requires managed provider access before listing platform ElevenLabs voices", async () => {
    const listVoices = vi.fn(async () => [
      { voice_id: "voice_1", name: "Narrator", category: "premade", preview_url: "https://example.test/v.mp3" },
    ]);
    const requireManagedProviderAccess = vi.fn(async () => ({}));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/elevenlabs", () => ({ listVoices }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      requireManagedProviderAccess,
      requireByokProviderAccess: vi.fn(),
    }));
    vi.doMock("@/lib/tenant", () => ({
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));

    const { GET } = await import("../app/api/eleven/voices/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireManagedProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(listVoices).toHaveBeenCalledWith();
    expect(body).toEqual({
      source: "elevenlabs",
      voices: [{ id: "voice_1", name: "Narrator", category: "premade", previewUrl: "https://example.test/v.mp3" }],
    });
  });

  it("requires BYOK provider access before checking user ElevenLabs voices", async () => {
    const listVoices = vi.fn(async () => []);
    const requireByokProviderAccess = vi.fn(async () => ({}));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/elevenlabs", () => ({ listVoices }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      requireManagedProviderAccess: vi.fn(),
      requireByokProviderAccess,
    }));
    vi.doMock("@/lib/tenant", () => ({
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));

    const { POST } = await import("../app/api/eleven/voices/route");
    const res = await POST(new Request("http://test.local/api/eleven/voices", {
      method: "POST",
      body: JSON.stringify({ apiKey: "user-eleven-key" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(listVoices).toHaveBeenCalledWith({ apiKey: "user-eleven-key" });
    expect(body).toEqual({ source: "byok", voices: [] });
  });

  it("serves fallback Hedra models without touching Hedra when managed access is unavailable", async () => {
    const listModels = vi.fn();
    const requireManagedProviderAccess = vi.fn(async () => {
      throw { status: 402, code: "managed_provider_not_enabled" };
    });

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/hedra", () => ({ listModels }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireManagedProviderAccess }));
    vi.doMock("@/lib/tenant", () => ({
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));

    const { GET } = await import("../app/api/hedra/models/route");
    const res = await GET(new Request("http://test.local/api/hedra/models?type=image"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(listModels).not.toHaveBeenCalled();
    expect(body.source).toBe("fallback");
    expect(body.providerAccess).toBe("managed_unavailable");
    expect(body.models.every((model: { type: string }) => model.type === "image")).toBe(true);
  });

  it("uses live Hedra models only after managed provider access is allowed", async () => {
    const listModels = vi.fn(async () => [{ id: "m1", name: "Image", type: "image" }]);
    const requireManagedProviderAccess = vi.fn(async () => ({}));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/hedra", () => ({ listModels }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireManagedProviderAccess }));
    vi.doMock("@/lib/tenant", () => ({
      tenantNotFound: () => Response.json({ error: "Not found.", code: "not_found" }, { status: 404 }),
    }));

    const { GET } = await import("../app/api/hedra/models/route");
    const res = await GET(new Request("http://test.local/api/hedra/models?type=image"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireManagedProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(listModels).toHaveBeenCalledWith(["image"]);
    expect(body).toEqual({ source: "hedra", models: [{ id: "m1", name: "Image", type: "image" }] });
  });
});
