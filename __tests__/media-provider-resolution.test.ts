import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hosted media provider profile resolution", () => {
  it("resolves an exact saved OpenAI audio profile without falling back to env settings", async () => {
    const getHostedMediaProviderProfile = vi.fn(async () => ({
      id: "openai-audio",
      label: "OpenAI Audio",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      baseUrl: "https://api.openai.com/v1",
      hasApiKey: true,
      apiKey: "sk-openai-audio",
    }));
    const getHostedMediaProviderProfileForProvider = vi.fn();

    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/desktopSettings", () => ({ desktopMediaProvider: vi.fn(() => null) }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile,
      getHostedMediaProviderProfileForProvider,
      getHostedMediaProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderProfile: vi.fn(),
      getHostedProviderProfileForProvider: vi.fn(),
      getHostedProviderSettings: vi.fn(),
    }));

    const { getAudioProviderForUser } = await import("@/lib/mediaProviders");
    const config = await getAudioProviderForUser(
      undefined,
      { id: "user_1", workspaceId: "workspace_1" },
      {} as NodeJS.ProcessEnv,
      "openai-audio",
    );

    expect(config).toEqual({
      provider: "openai",
      apiKey: "sk-openai-audio",
      baseUrl: "https://api.openai.com/v1",
      providerSource: "byok",
      profileId: "openai-audio",
    });
    expect(getHostedMediaProviderProfile).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1" },
      "openai-audio",
    );
    expect(getHostedMediaProviderProfileForProvider).not.toHaveBeenCalled();
  });

  it("resolves an exact saved xAI image profile for image generation", async () => {
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/desktopSettings", () => ({ desktopMediaProvider: vi.fn(() => null) }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile: vi.fn(async () => ({
        id: "xai-image",
        label: "xAI Image",
        provider: "xai",
        model: "grok-2-image",
        baseUrl: "https://api.x.ai/v1",
        hasApiKey: true,
        apiKey: "xai-secret",
      })),
      getHostedMediaProviderProfileForProvider: vi.fn(),
      getHostedMediaProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderProfile: vi.fn(),
      getHostedProviderProfileForProvider: vi.fn(),
      getHostedProviderSettings: vi.fn(),
    }));

    const { getImageProviderForUser } = await import("@/lib/mediaProviders");
    const config = await getImageProviderForUser(
      undefined,
      { id: "user_1", workspaceId: "workspace_1" },
      {} as NodeJS.ProcessEnv,
      "xai-image",
    );

    expect(config).toEqual({
      provider: "xai",
      apiKey: "xai-secret",
      baseUrl: "https://api.x.ai/v1",
      providerSource: "byok",
      profileId: "xai-image",
    });
  });

  it("reuses a saved OpenAI LLM profile for audio generation when no media profile is saved", async () => {
    const getHostedMediaProviderProfile = vi.fn(async () => null);
    const getHostedMediaProviderProfileForProvider = vi.fn(async () => null);
    const getHostedProviderProfile = vi.fn(async () => ({
      id: "openai-main",
      label: "OpenAI Main",
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      hasApiKey: true,
      apiKey: "sk-openai-llm",
    }));

    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/desktopSettings", () => ({ desktopMediaProvider: vi.fn(() => null) }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile,
      getHostedMediaProviderProfileForProvider,
      getHostedMediaProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderProfile,
      getHostedProviderProfileForProvider: vi.fn(),
      getHostedProviderSettings: vi.fn(),
    }));

    const { getAudioProviderForUser } = await import("@/lib/mediaProviders");
    const config = await getAudioProviderForUser(
      undefined,
      { id: "user_1", workspaceId: "workspace_1" },
      {} as NodeJS.ProcessEnv,
      "openai-main",
    );

    expect(config).toEqual({
      provider: "openai",
      apiKey: "sk-openai-llm",
      baseUrl: "https://api.openai.com/v1",
      providerSource: "byok",
      profileId: "openai-main",
    });
    expect(getHostedMediaProviderProfile).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1" },
      "openai-main",
    );
    expect(getHostedProviderProfile).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1" },
      "openai-main",
    );
    expect(getHostedMediaProviderProfileForProvider).not.toHaveBeenCalled();
  });

  it("reuses a saved xAI LLM profile for image generation by provider default", async () => {
    const getHostedProviderProfileForProvider = vi.fn(async () => ({
      id: "xai-main",
      label: "xAI Main",
      provider: "xai",
      model: "grok-3",
      baseUrl: "https://api.x.ai/v1",
      hasApiKey: true,
      apiKey: "xai-llm-secret",
    }));

    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/desktopSettings", () => ({ desktopMediaProvider: vi.fn(() => null) }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile: vi.fn(),
      getHostedMediaProviderProfileForProvider: vi.fn(async () => null),
      getHostedMediaProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderProfile: vi.fn(),
      getHostedProviderProfileForProvider,
      getHostedProviderSettings: vi.fn(),
    }));

    const { getImageProviderForUser } = await import("@/lib/mediaProviders");
    const config = await getImageProviderForUser(
      "xai",
      { id: "user_1", workspaceId: "workspace_1" },
      {} as NodeJS.ProcessEnv,
    );

    expect(config).toEqual({
      provider: "xai",
      apiKey: "xai-llm-secret",
      baseUrl: "https://api.x.ai/v1",
      providerSource: "byok",
      profileId: "xai-main",
    });
    expect(getHostedProviderProfileForProvider).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1" },
      "xai",
    );
  });
});
