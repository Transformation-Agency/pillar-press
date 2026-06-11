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
    const saveHostedProviderSettings = vi.fn(async () => savedSettings);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
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
    expect(saveHostedProviderSettings).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      expect.objectContaining({
        profiles: [expect.objectContaining({ apiKey: "sk-should-not-return" })],
      }),
    );
    expect(body).toEqual({ settings: savedSettings });
    expect(JSON.stringify(body)).not.toContain("sk-should-not-return");
  });
});
