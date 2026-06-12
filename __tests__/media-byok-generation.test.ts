import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hosted media BYOK resolver", () => {
  it("marks saved hosted media providers as configured without exposing keys", async () => {
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/desktopSettings", () => ({ desktopMediaProvider: vi.fn(() => null) }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderSettings: vi.fn(async () => ({
        profiles: [{
          id: "openai-media",
          label: "OpenAI Media",
          provider: "openai",
          model: "gpt-image-1",
          hasApiKey: true,
        }, {
          id: "hedra-main",
          label: "Hedra",
          provider: "hedra",
          hasApiKey: true,
        }],
        defaultProfileId: "openai-media",
      })),
      getHostedMediaProviderProfileForProvider: vi.fn(),
    }));

    const { getMediaProviderStatusForUser } = await import("@/lib/mediaProviders");
    const status = await getMediaProviderStatusForUser(
      { id: "user_1", workspaceId: "workspace_1" },
      {} as NodeJS.ProcessEnv,
    );

    expect(status.openai.configured).toBe(true);
    expect(status.openai.sources).toContain("byok");
    expect(status.openai.profileIds).toContain("openai-media");
    expect(status.hedra.configured).toBe(true);
    expect(status.hedra.sources).toContain("byok");
    expect(JSON.stringify(status)).not.toContain("sk-");
  });
});

describe("POST /api/hedra/generate hosted media BYOK", () => {
  it("uses a saved OpenAI media key for image generation and reserves BYOK usage", async () => {
    const reservation = { id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "k" };
    const reserveUsage = vi.fn(async () => reservation);
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();
    const generateOpenAICompatibleImage = vi.fn(async () => ({
      outputUrl: "https://cdn.test/image.png",
      downloadUrl: "https://cdn.test/image.png",
      providerResponseId: "img_1",
    }));
    const inserted: Array<Record<string, unknown>> = [];
    const returning = vi.fn(async () => [{ id: "job_1", outputUrl: "https://cdn.test/image.png" }]);
    const values = vi.fn((value) => {
      inserted.push(value);
      return { returning };
    });

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/tenant", () => ({
      campaignInWorkspace: vi.fn(async () => true),
      tenantNotFound: vi.fn(() => new Response(JSON.stringify({ code: "not_found" }), { status: 404 })),
    }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return {
        ...actual,
        db: {
          insert: vi.fn(() => ({ values })),
          query: {
            pieces: { findFirst: vi.fn() },
            references: { findFirst: vi.fn() },
            styleProfiles: { findFirst: vi.fn() },
          },
        },
      };
    });
    vi.doMock("@/db/style-schema", () => ({ styleProfiles: { campaignId: "style_profiles.campaign_id" } }));
    vi.doMock("@/lib/local/database", () => ({
      createLocalMediaJob: vi.fn(),
      getLocalMediaJob: vi.fn(),
      getLocalPiece: vi.fn(),
      getLocalReferences: vi.fn(),
      getLocalStyleProfile: vi.fn(),
    }));
    vi.doMock("@/lib/mediaProviders", () => ({
      getImageProviderForUser: vi.fn(async () => ({
        provider: "openai",
        apiKey: "sk-media-secret",
        baseUrl: "https://api.openai.com/v1",
        providerSource: "byok",
        profileId: "openai-media",
      })),
      getAudioProviderForUser: vi.fn(async () => null),
      getElevenLabsProviderForUser: vi.fn(async () => null),
      getHedraProviderForUser: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage }));
    vi.doMock("@/lib/mediaAudio", () => ({ generateOpenAICompatibleSpeech: vi.fn() }));
    vi.doMock("@/lib/hedra", () => ({
      listModels: vi.fn(),
      generateAsset: vi.fn(),
      createAsset: vi.fn(),
      uploadAsset: vi.fn(),
    }));
    vi.doMock("@/lib/elevenlabs", () => ({ textToSpeechLong: vi.fn() }));
    vi.doMock("@/lib/storage", () => ({ uploadPublicAudio: vi.fn() }));
    vi.doMock("@/lib/ai/imagePrompt", () => ({ craftImagePrompt: vi.fn() }));
    vi.doMock("@/lib/llm", () => ({ getAIForTaskForUser: vi.fn() }));
    vi.doMock("@/lib/refContext", () => ({ buildRefContext: vi.fn(() => "") }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage,
      completeUsageReservation,
      failUsageReservation,
    }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      requireConcurrentJobCapacity: vi.fn(async () => ({ current: 0, limit: 1 })),
    }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "image",
        provider: "openai",
        modelId: "gpt-image-1",
        prompt: "Create a cover image.",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ job: { id: "job_1", outputUrl: "https://cdn.test/image.png" } });
    expect(generateOpenAICompatibleImage).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        provider: "openai",
        apiKey: "sk-media-secret",
        providerSource: "byok",
        profileId: "openai-media",
      }),
      model: "gpt-image-1",
    }));
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "media_generation",
      feature: "media.image",
      providerSource: "byok",
      provider: "openai",
      model: "gpt-image-1",
      metadata: { profileId: "openai-media" },
    }));
    expect(inserted[0]).toMatchObject({
      type: "image",
      meta: expect.objectContaining({
        provider: "openai",
        providerSource: "byok",
        profileId: "openai-media",
        providerResponseId: "img_1",
      }),
    });
    expect(JSON.stringify(body)).not.toContain("sk-media-secret");
    expect(completeUsageReservation).toHaveBeenCalledWith(reservation, {
      metadata: { providerResponseId: "img_1" },
    });
    expect(failUsageReservation).not.toHaveBeenCalled();
  });
});
