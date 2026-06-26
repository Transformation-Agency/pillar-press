import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted media provider saved-profile tests", () => {
  it("tests a local-first desktop OpenAI media provider without returning the API key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "gpt-image-1" }, { id: "gpt-4o-mini-tts" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local-user", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/desktopSettings", () => ({
      desktopMediaProvider: vi.fn(() => ({
        apiKey: "sk-desktop-openai-secret",
        baseUrl: "https://api.openai.com/v1",
      })),
    }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess: vi.fn() }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent: vi.fn() }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({ getHostedMediaProviderProfile: vi.fn() }));
    vi.doMock("@/lib/hedra", () => ({ getCredits: vi.fn() }));
    vi.doMock("@/lib/elevenlabs", () => ({ listVoices: vi.fn() }));

    const { POST } = await import("../app/api/media/provider-settings/test/route");
    const res = await POST(new Request("http://test.local/api/media/provider-settings/test", {
      method: "POST",
      body: JSON.stringify({ profileId: "desktop-openai" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer sk-desktop-openai-secret",
      }),
    }));
    expect(body).toEqual({
      ok: true,
      provider: "openai",
      profileId: "desktop-openai",
      label: "openai",
      check: { kind: "models", count: 2 },
    });
    expect(JSON.stringify(body)).not.toContain("sk-desktop-openai-secret");
  });

  it("tests a saved OpenAI media profile without returning the API key", async () => {
    const requireByokProviderAccess = vi.fn(async () => ({}));
    const getHostedMediaProviderProfile = vi.fn(async () => ({
      id: "openai-media",
      label: "OpenAI media",
      provider: "openai",
      model: "gpt-image-1",
      baseUrl: "https://api.openai.com/v1",
      hasApiKey: true,
      apiKey: "sk-openai-media-secret",
    }));
    const safeRecordAuditEvent = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "gpt-image-1" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile,
    }));
    vi.doMock("@/lib/hedra", () => ({ getCredits: vi.fn() }));
    vi.doMock("@/lib/elevenlabs", () => ({ listVoices: vi.fn() }));

    const { POST } = await import("../app/api/media/provider-settings/test/route");
    const res = await POST(new Request("http://test.local/api/media/provider-settings/test", {
      method: "POST",
      body: JSON.stringify({ profileId: "openai-media" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(getHostedMediaProviderProfile).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      "openai-media",
    );
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer sk-openai-media-secret",
      }),
    }));
    expect(body).toEqual({
      ok: true,
      provider: "openai",
      profileId: "openai-media",
      label: "OpenAI media",
      check: { kind: "models", count: 1 },
    });
    expect(JSON.stringify(body)).not.toContain("sk-openai-media-secret");
    expect(safeRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      actorId: "user_1",
      action: "provider_settings.tested",
      targetType: "provider_secrets",
      targetId: "openai-media",
      metadata: {
        kind: "media",
        profileId: "openai-media",
        provider: "openai",
        ok: true,
      },
    }));
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("sk-openai-media-secret");
  });

  it("tests a saved Hedra media profile through credits without returning the API key", async () => {
    const requireByokProviderAccess = vi.fn(async () => ({}));
    const getHostedMediaProviderProfile = vi.fn(async () => ({
      id: "hedra-main",
      label: "Hedra",
      provider: "hedra",
      hasApiKey: true,
      apiKey: "user-hedra-secret",
    }));
    const getCredits = vi.fn(async () => ({ remaining: 12 }));
    const safeRecordAuditEvent = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile,
    }));
    vi.doMock("@/lib/hedra", () => ({ getCredits }));
    vi.doMock("@/lib/elevenlabs", () => ({ listVoices: vi.fn() }));

    const { POST } = await import("../app/api/media/provider-settings/test/route");
    const res = await POST(new Request("http://test.local/api/media/provider-settings/test", {
      method: "POST",
      body: JSON.stringify({ profileId: "hedra-main" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(getCredits).toHaveBeenCalledWith({ apiKey: "user-hedra-secret" });
    expect(body).toEqual({
      ok: true,
      provider: "hedra",
      profileId: "hedra-main",
      label: "Hedra",
      check: { kind: "credits", remaining: 12 },
    });
    expect(JSON.stringify(body)).not.toContain("user-hedra-secret");
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("user-hedra-secret");
  });
});
