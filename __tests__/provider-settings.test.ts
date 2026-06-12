import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.KINGS_PRESS_HOSTED_SECRET_KEY;
  delete process.env.KINGS_PRESS_ENCRYPTION_KEY;
  delete process.env.AUTH_SECRET;
});

describe("hosted provider setting encryption", () => {
  it("encrypts hosted provider keys without exposing the raw value", async () => {
    process.env.KINGS_PRESS_HOSTED_SECRET_KEY = "test-hosted-secret";
    const { decryptHostedSecret, encryptHostedSecret } = await import("@/lib/providerSettings");

    const encrypted = encryptHostedSecret("sk-live-secret")!;

    expect(encrypted).toMatch(/^kphost:v1:/);
    expect(encrypted).not.toContain("sk-live-secret");
    expect(decryptHostedSecret(encrypted)).toBe("sk-live-secret");
    expect(decryptHostedSecret(encrypted, { KINGS_PRESS_HOSTED_SECRET_KEY: "wrong-secret" } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe("hosted provider settings API", () => {
  it("rejects hosted LLM provider base URLs that target local or private services", async () => {
    process.env.KINGS_PRESS_HOSTED_SECRET_KEY = "test-hosted-secret";
    const limit = vi.fn(async () => []);
    const where = vi.fn(() => ({ limit }));
    const insert = vi.fn();
    const select = vi.fn(() => ({ from: () => ({ where }) }));

    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return { ...actual, db: { select, insert } };
    });

    const { saveHostedProviderSettings } = await import("@/lib/providerSettings");
    await expect(saveHostedProviderSettings(
      { id: "user_1", workspaceId: "workspace_1" },
      {
        profiles: [{
          id: "local-ollama",
          label: "Local Ollama",
          provider: "ollama",
          model: "llama3.1",
          baseUrl: "http://127.0.0.1:11434",
          apiKey: "not-needed",
        }],
      },
    )).rejects.toMatchObject({ code: "invalid_provider_base_url", status: 422 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("saves provider settings and returns only sanitized metadata", async () => {
    const savedSettings = {
      profiles: [{
        id: "openai-gpt-4o-mini",
        label: "OpenAI / ChatGPT gpt-4o-mini",
        provider: "openai",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
        hasApiKey: true,
      }],
      defaultProfileId: "openai-gpt-4o-mini",
      taskDefaults: { draft: "openai-gpt-4o-mini" },
    };
    const requireByokProviderAccess = vi.fn(async () => ({}));
    const saveHostedProviderSettings = vi.fn(async () => savedSettings);
    const safeRecordAuditEvent = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess }));
    vi.doMock("@/lib/providerSettings", async () => {
      const actual = await vi.importActual<any>("@/lib/providerSettings");
      return {
        ...actual,
        getHostedProviderSettings: vi.fn(async () => savedSettings),
        saveHostedProviderSettings,
      };
    });

    const { PUT } = await import("../app/api/provider-settings/route");
    const res = await PUT(new Request("http://test.local/api/provider-settings", {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          profiles: [{
            id: "openai-gpt-4o-mini",
            label: "OpenAI / ChatGPT gpt-4o-mini",
            provider: "openai",
            model: "gpt-4o-mini",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-should-not-return",
          }],
          defaultProfileId: "openai-gpt-4o-mini",
          taskDefaults: { draft: "openai-gpt-4o-mini" },
        },
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(saveHostedProviderSettings).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      expect.objectContaining({
        profiles: [expect.objectContaining({ apiKey: "sk-should-not-return" })],
      }),
    );
    expect(body).toEqual({ settings: savedSettings });
    expect(JSON.stringify(body)).not.toContain("sk-should-not-return");
    expect(safeRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace_1",
      actorId: "user_1",
      action: "provider_settings.updated",
      targetType: "provider_secrets",
      metadata: expect.objectContaining({
        kind: "llm",
        profileCount: 1,
        defaultProfileId: "openai-gpt-4o-mini",
        profiles: [expect.objectContaining({
          id: "openai-gpt-4o-mini",
          provider: "openai",
          hasApiKey: true,
        })],
      }),
    }));
    expect(JSON.stringify(safeRecordAuditEvent.mock.calls)).not.toContain("sk-should-not-return");
  });

  it("does not save hosted LLM provider settings when BYOK is not included in the plan", async () => {
    const requireByokProviderAccess = vi.fn(async () => {
      const { BillingError } = await import("@/lib/billing/stripe");
      throw new BillingError(402, "byok_provider_not_enabled", "Bring-your-own-key provider usage is not included in your current plan.");
    });
    const saveHostedProviderSettings = vi.fn();
    const safeRecordAuditEvent = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/audit", () => ({ safeRecordAuditEvent }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess }));
    vi.doMock("@/lib/providerSettings", async () => {
      const actual = await vi.importActual<any>("@/lib/providerSettings");
      return {
        ...actual,
        getHostedProviderSettings: vi.fn(),
        saveHostedProviderSettings,
      };
    });

    const { PUT } = await import("../app/api/provider-settings/route");
    const res = await PUT(new Request("http://test.local/api/provider-settings", {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          profiles: [{
            id: "openai-gpt-4o-mini",
            provider: "openai",
            model: "gpt-4o-mini",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-should-not-save",
          }],
        },
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "Bring-your-own-key provider usage is not included in your current plan.",
      code: "byok_provider_not_enabled",
    });
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(saveHostedProviderSettings).not.toHaveBeenCalled();
    expect(safeRecordAuditEvent).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("sk-should-not-save");
  });
});
