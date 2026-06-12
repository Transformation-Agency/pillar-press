import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.KINGS_PRESS_HOSTED_SECRET_KEY = "test-hosted-secret";
});

describe("hosted media provider settings", () => {
  it("stores media provider rows as kind media and returns only sanitized metadata", async () => {
    const encryptedValues: Array<Record<string, unknown>> = [];
    const returning = vi.fn(async () => []);
    const onConflictDoUpdate = vi.fn(() => ({ returning }));
    const values = vi.fn((value) => {
      encryptedValues.push(value);
      return { onConflictDoUpdate };
    });
    const insert = vi.fn(() => ({ values }));
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn(async () => []),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: vi.fn(async () => [{
            profileId: "hedra-main",
            label: "Hedra Main",
            provider: "hedra",
            model: "hedra-image-1",
            baseUrl: null,
            encryptedApiKey: encryptedValues[0]?.encryptedApiKey,
            hasApiKey: true,
            isDefault: true,
          }]),
        }),
      });

    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select, insert } };
    });

    const { saveHostedMediaProviderSettings } = await import("@/lib/mediaProviderSettings");
    const settings = await saveHostedMediaProviderSettings(
      { id: "user_1", workspaceId: "workspace_1" },
      {
        profiles: [{
          id: "hedra-main",
          label: "Hedra Main",
          provider: "hedra",
          model: "hedra-image-1",
          apiKey: "hedra-secret",
        }],
        defaultProfileId: "hedra-main",
      },
    );

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      kind: "media",
      profileId: "hedra-main",
      provider: "hedra",
      model: "hedra-image-1",
      hasApiKey: true,
      isDefault: true,
    }));
    expect(String(encryptedValues[0].encryptedApiKey)).toMatch(/^kphost:v1:/);
    expect(JSON.stringify(encryptedValues)).not.toContain("hedra-secret");
    expect(settings).toEqual({
      profiles: [{
        id: "hedra-main",
        label: "Hedra Main",
        provider: "hedra",
        model: "hedra-image-1",
        hasApiKey: true,
      }],
      defaultProfileId: "hedra-main",
    });
    expect(JSON.stringify(settings)).not.toContain("hedra-secret");
  });

  it("PUT requires BYOK access and returns sanitized media settings", async () => {
    const savedSettings = {
      profiles: [{
        id: "eleven-main",
        label: "ElevenLabs",
        provider: "elevenlabs",
        model: "eleven-tts-multilingual-v2",
        hasApiKey: true,
      }],
      defaultProfileId: "eleven-main",
    };
    const requireByokProviderAccess = vi.fn(async () => ({}));
    const saveHostedMediaProviderSettings = vi.fn(async () => savedSettings);
    const safeRecordAuditEvent = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderSettings: vi.fn(async () => savedSettings),
      saveHostedMediaProviderSettings,
    }));

    const { PUT } = await import("../app/api/media/provider-settings/route");
    const res = await PUT(new Request("http://test.local/api/media/provider-settings", {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          profiles: [{
            id: "eleven-main",
            label: "ElevenLabs",
            provider: "elevenlabs",
            model: "eleven-tts-multilingual-v2",
            apiKey: "eleven-secret",
          }],
          defaultProfileId: "eleven-main",
        },
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(saveHostedMediaProviderSettings).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      expect.objectContaining({
        profiles: [expect.objectContaining({ apiKey: "eleven-secret" })],
      }),
    );
    expect(body).toEqual({ settings: savedSettings });
    expect(JSON.stringify(body)).not.toContain("eleven-secret");
    expect(safeRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      actorId: "user_1",
      action: "provider_settings.updated",
      targetType: "provider_secrets",
      metadata: expect.objectContaining({
        kind: "media",
        profileCount: 1,
        defaultProfileId: "eleven-main",
        profiles: [expect.objectContaining({
          id: "eleven-main",
          provider: "elevenlabs",
          hasApiKey: true,
        })],
      }),
    }));
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("eleven-secret");
  });
});
