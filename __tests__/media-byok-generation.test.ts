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
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderSettings: vi.fn(async () => ({
        profiles: [],
        defaultProfileId: null,
        taskDefaults: {},
      })),
      getHostedProviderProfile: vi.fn(),
      getHostedProviderProfileForProvider: vi.fn(),
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

  it("marks compatible hosted LLM BYOK profiles as media-capable without exposing keys", async () => {
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/desktopSettings", () => ({ desktopMediaProvider: vi.fn(() => null) }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderSettings: vi.fn(async () => ({
        profiles: [],
        defaultProfileId: null,
      })),
      getHostedMediaProviderProfileForProvider: vi.fn(),
    }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderSettings: vi.fn(async () => ({
        profiles: [{
          id: "openai-main",
          label: "OpenAI Main",
          provider: "openai",
          model: "gpt-4o-mini",
          hasApiKey: true,
        }, {
          id: "xai-main",
          label: "xAI Main",
          provider: "xai",
          model: "grok-3",
          hasApiKey: true,
        }],
        defaultProfileId: "openai-main",
        taskDefaults: {},
      })),
      getHostedProviderProfile: vi.fn(),
      getHostedProviderProfileForProvider: vi.fn(),
    }));

    const { getMediaProviderStatusForUser } = await import("@/lib/mediaProviders");
    const status = await getMediaProviderStatusForUser(
      { id: "user_1", workspaceId: "workspace_1" },
      {} as NodeJS.ProcessEnv,
    );

    expect(status.openai.configured).toBe(true);
    expect(status.openai.sources).toContain("byok");
    expect(status.openai.profileIds).toContain("openai-main");
    expect(status.openai.models.some((model) => model.id === "gpt-image-1" && model.profileId === "openai-main")).toBe(true);
    expect(status.openai.models.some((model) => model.id === "gpt-4o-mini-tts" && model.profileId === "openai-main")).toBe(true);
    expect(status.xai.configured).toBe(true);
    expect(status.xai.profileIds).toContain("xai-main");
    expect(status.xai.models.some((model) => model.id === "grok-2-image" && model.profileId === "xai-main")).toBe(true);
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("sk-");
  });
});

describe("POST /api/hedra/generate hosted media BYOK", () => {
  it("returns a setup action instead of calling Hedra when no video provider is configured", async () => {
    const listModels = vi.fn();
    const requireManagedProviderAccess = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/tenant", () => ({
      campaignInWorkspace: vi.fn(async () => true),
      tenantNotFound: vi.fn(() => new Response(JSON.stringify({ code: "not_found" }), { status: 404 })),
    }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return {
        ...actual,
        db: {
          query: {
            pieces: { findFirst: vi.fn() },
            references: { findFirst: vi.fn() },
            styleProfiles: { findFirst: vi.fn() },
            mediaJobs: { findFirst: vi.fn() },
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
      getImageProviderForUser: vi.fn(async () => null),
      getAudioProviderForUser: vi.fn(async () => null),
      getElevenLabsProviderForUser: vi.fn(async () => null),
      getHedraProviderForUser: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage: vi.fn() }));
    vi.doMock("@/lib/mediaAudio", () => ({
      generateOpenAICompatibleSpeech: vi.fn(),
      synthesizeOpenAICompatibleSpeech: vi.fn(),
    }));
    vi.doMock("@/lib/hedra", () => ({
      listModels,
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
      reserveUsage: vi.fn(),
      completeUsageReservation: vi.fn(),
      failUsageReservation: vi.fn(),
    }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      requireConcurrentJobCapacity: vi.fn(async () => ({ current: 0, limit: 1 })),
      requireByokProviderAccess: vi.fn(),
      requireManagedProviderAccess,
    }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "avatar_video",
        provider: "hedra",
        modelId: "hedra-avatar",
        prompt: "A speaking editorial portrait.",
        startAssetId: "asset_1",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "Connect Hedra in Studio Providers before generating video or avatar media.",
      code: "media_provider_required",
    });
    expect(listModels).not.toHaveBeenCalled();
    expect(requireManagedProviderAccess).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("HEDRA_API_KEY");
    expect(JSON.stringify(body)).not.toContain("sk-");
  });

  it("returns a setup action before synced video voiceover when no voice provider is configured", async () => {
    const listModels = vi.fn();

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
          query: {
            pieces: { findFirst: vi.fn() },
            references: { findFirst: vi.fn() },
            styleProfiles: { findFirst: vi.fn() },
            mediaJobs: { findFirst: vi.fn() },
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
      getImageProviderForUser: vi.fn(async () => null),
      getAudioProviderForUser: vi.fn(async () => null),
      getElevenLabsProviderForUser: vi.fn(async () => null),
      getHedraProviderForUser: vi.fn(async () => ({
        provider: "hedra",
        apiKey: "user-hedra-secret",
        providerSource: "byok",
        profileId: "hedra-main",
      })),
    }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage: vi.fn() }));
    vi.doMock("@/lib/mediaAudio", () => ({
      generateOpenAICompatibleSpeech: vi.fn(),
      synthesizeOpenAICompatibleSpeech: vi.fn(),
    }));
    vi.doMock("@/lib/hedra", () => ({
      listModels,
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
      reserveUsage: vi.fn(),
      completeUsageReservation: vi.fn(),
      failUsageReservation: vi.fn(),
    }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      requireConcurrentJobCapacity: vi.fn(async () => ({ current: 0, limit: 1 })),
      requireByokProviderAccess: vi.fn(),
      requireManagedProviderAccess: vi.fn(),
    }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "video",
        provider: "hedra",
        modelId: "hedra-video",
        prompt: "Animate this image.",
        script: "Read this as a synced voiceover.",
        startAssetId: "asset_1",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "Connect OpenAI media or ElevenLabs in Studio Providers before generating synced voiceover video.",
      code: "media_provider_required",
    });
    expect(listModels).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("ELEVENLABS_API_KEY");
    expect(JSON.stringify(body)).not.toContain("user-hedra-secret");
  });

  it("uses an exact saved OpenAI media profile for audio generation", async () => {
    const reservation = { id: "usage_audio", workspaceId: "workspace_1", idempotencyKey: "k" };
    const reserveUsage = vi.fn(async () => reservation);
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();
    const getAudioProviderForUser = vi.fn(async () => ({
      provider: "openai",
      apiKey: "sk-openai-audio",
      baseUrl: "https://api.openai.com/v1",
      providerSource: "byok",
      profileId: "openai-audio",
    }));
    const getElevenLabsProviderForUser = vi.fn();
    const generateOpenAICompatibleSpeech = vi.fn(async () => ({
      outputUrl: "https://cdn.test/audio.mp3",
      downloadUrl: "https://cdn.test/audio.mp3",
      voice: "alloy",
    }));
    const inserted: Array<Record<string, unknown>> = [];
    const returning = vi.fn(async () => [{ id: "job_audio", outputUrl: "https://cdn.test/audio.mp3" }]);
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
      getImageProviderForUser: vi.fn(async () => null),
      getAudioProviderForUser,
      getElevenLabsProviderForUser,
      getHedraProviderForUser: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage: vi.fn() }));
    vi.doMock("@/lib/mediaAudio", () => ({
      generateOpenAICompatibleSpeech,
      synthesizeOpenAICompatibleSpeech: vi.fn(),
    }));
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
      requireByokProviderAccess: vi.fn(async () => ({})),
      requireManagedProviderAccess: vi.fn(async () => ({})),
    }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "audio",
        provider: "openai",
        mediaProfileId: "openai-audio",
        modelId: "gpt-4o-mini-tts",
        script: "Read this draft aloud.",
        voiceId: "alloy",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ job: { id: "job_audio", outputUrl: "https://cdn.test/audio.mp3" } });
    expect(getAudioProviderForUser).toHaveBeenCalledWith(
      "openai",
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      process.env,
      "openai-audio",
    );
    expect(getElevenLabsProviderForUser).not.toHaveBeenCalled();
    expect(generateOpenAICompatibleSpeech).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        provider: "openai",
        apiKey: "sk-openai-audio",
        profileId: "openai-audio",
      }),
      model: "gpt-4o-mini-tts",
      text: "Read this draft aloud.",
      voice: "alloy",
    }));
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "media_generation",
      feature: "media.audio",
      providerSource: "byok",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      metadata: { profileId: "openai-audio" },
    }));
    expect(inserted[0]).toMatchObject({
      type: "audio",
      meta: expect.objectContaining({
        provider: "openai",
        providerSource: "byok",
        profileId: "openai-audio",
      }),
    });
    expect(JSON.stringify(body)).not.toContain("sk-openai-audio");
    expect(completeUsageReservation).toHaveBeenCalledWith(reservation);
    expect(failUsageReservation).not.toHaveBeenCalled();
  });

  it("uses saved Hedra BYOK video with saved OpenAI BYOK voiceover audio", async () => {
    const reservation = { id: "usage_video", workspaceId: "workspace_1", idempotencyKey: "k" };
    const reserveUsage = vi.fn(async () => reservation);
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();
    const requireByokProviderAccess = vi.fn(async () => ({}));
    const requireManagedProviderAccess = vi.fn();
    const listModels = vi.fn(async () => [{
      id: "hedra-video-v1",
      name: "Hedra Video",
      type: "video",
      credits: 3,
    }]);
    const createAsset = vi.fn(async () => ({ id: "audio_asset_1" }));
    const uploadAsset = vi.fn(async () => ({ id: "audio_asset_1" }));
    const generateAsset = vi.fn(async () => ({
      id: "gen_video",
      status: "queued",
      progress: 0,
      asset_id: "video_asset_1",
    }));
    const synthesizeOpenAICompatibleSpeech = vi.fn(async () => ({
      bytes: Buffer.from("mp3-bytes"),
      voice: "alloy",
    }));
    const getHedraProviderForUser = vi.fn(async () => ({
      provider: "hedra",
      apiKey: "user-hedra-secret",
      providerSource: "byok",
      profileId: "hedra-main",
    }));
    const getAudioProviderForUser = vi.fn(async () => ({
      provider: "openai",
      apiKey: "sk-openai-audio",
      baseUrl: "https://api.openai.com/v1",
      providerSource: "byok",
      profileId: "openai-audio",
    }));
    const getElevenLabsProviderForUser = vi.fn();
    const inserted: Array<Record<string, unknown>> = [];
    const returning = vi.fn(async () => [{ id: "job_video", hedraGenerationId: "gen_video" }]);
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
      getImageProviderForUser: vi.fn(async () => null),
      getAudioProviderForUser,
      getElevenLabsProviderForUser,
      getHedraProviderForUser,
    }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage: vi.fn() }));
    vi.doMock("@/lib/mediaAudio", () => ({
      generateOpenAICompatibleSpeech: vi.fn(),
      synthesizeOpenAICompatibleSpeech,
    }));
    vi.doMock("@/lib/hedra", () => ({
      listModels,
      generateAsset,
      createAsset,
      uploadAsset,
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
      requireByokProviderAccess,
      requireManagedProviderAccess,
    }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "video",
        provider: "hedra",
        mediaProfileId: "hedra-main",
        audioMediaProfileId: "openai-audio",
        modelId: "hedra-video-v1",
        prompt: "Make a short video.",
        script: "Read this as the synced narration.",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ job: { id: "job_video", hedraGenerationId: "gen_video" } });
    expect(getHedraProviderForUser).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      process.env,
      "hedra-main",
    );
    expect(getAudioProviderForUser).toHaveBeenCalledWith(
      "openai",
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      process.env,
      "openai-audio",
    );
    expect(getElevenLabsProviderForUser).not.toHaveBeenCalled();
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(requireManagedProviderAccess).not.toHaveBeenCalled();
    expect(synthesizeOpenAICompatibleSpeech).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        provider: "openai",
        apiKey: "sk-openai-audio",
        profileId: "openai-audio",
      }),
      model: "gpt-4o-mini-tts",
      text: "Read this as the synced narration.",
    }));
    expect(createAsset).toHaveBeenCalledWith({ name: expect.stringMatching(/^voiceover-/), type: "audio" }, { apiKey: "user-hedra-secret" });
    expect(uploadAsset).toHaveBeenCalledWith(
      "audio_asset_1",
      expect.any(Blob),
      expect.stringMatching(/^voiceover-/),
      { apiKey: "user-hedra-secret" },
    );
    expect(generateAsset).toHaveBeenCalledWith(expect.objectContaining({
      type: "video",
      modelId: "hedra-video-v1",
      audioAssetId: "audio_asset_1",
    }), { apiKey: "user-hedra-secret" });
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "media_generation",
      feature: "media.video",
      providerSource: "byok",
      provider: "hedra",
      model: "hedra-video-v1",
      metadata: expect.objectContaining({
        profileId: "hedra-main",
        hedraProfileId: "hedra-main",
        audioProfileId: "openai-audio",
      }),
    }));
    expect(inserted[0]).toMatchObject({
      type: "video",
      elevenAudioAssetId: "audio_asset_1",
      meta: expect.objectContaining({
        provider: "hedra",
        providerSource: "byok",
        profileId: "hedra-main",
        hedraProfileId: "hedra-main",
        audioProfileId: "openai-audio",
      }),
    });
    expect(JSON.stringify(body)).not.toContain("user-hedra-secret");
    expect(JSON.stringify(body)).not.toContain("sk-openai-audio");
    expect(completeUsageReservation).toHaveBeenCalledWith(reservation, {
      actualCredits: 3,
      providerRequestId: "gen_video",
    });
    expect(failUsageReservation).not.toHaveBeenCalled();
  });

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

  it("gates and uses a saved Hedra key for hosted image generation", async () => {
    const reservation = { id: "usage_hedra", workspaceId: "workspace_1", idempotencyKey: "k" };
    const requireByokProviderAccess = vi.fn(async () => ({}));
    const requireManagedProviderAccess = vi.fn();
    const reserveUsage = vi.fn(async () => reservation);
    const completeUsageReservation = vi.fn();
    const failUsageReservation = vi.fn();
    const listModels = vi.fn(async () => [{
      id: "hedra-image-v1",
      name: "Hedra Image",
      type: "image",
      credits: 2,
    }]);
    const generateAsset = vi.fn(async () => ({
      id: "gen_1",
      status: "queued",
      progress: 0,
      asset_id: "asset_1",
    }));
    const inserted: Array<Record<string, unknown>> = [];
    const returning = vi.fn(async () => [{ id: "job_hedra", hedraGenerationId: "gen_1" }]);
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
      getImageProviderForUser: vi.fn(async () => null),
      getAudioProviderForUser: vi.fn(async () => null),
      getElevenLabsProviderForUser: vi.fn(async () => null),
      getHedraProviderForUser: vi.fn(async () => ({
        provider: "hedra",
        apiKey: "user-hedra-secret",
        providerSource: "byok",
        profileId: "hedra-main",
      })),
    }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage: vi.fn() }));
    vi.doMock("@/lib/mediaAudio", () => ({ generateOpenAICompatibleSpeech: vi.fn() }));
    vi.doMock("@/lib/hedra", () => ({
      listModels,
      generateAsset,
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
      requireByokProviderAccess,
      requireManagedProviderAccess,
    }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "image",
        provider: "hedra",
        modelId: "hedra-image-v1",
        prompt: "Create a cover image.",
        enhance: false,
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(requireManagedProviderAccess).not.toHaveBeenCalled();
    expect(listModels).toHaveBeenCalledWith(["image"], { apiKey: "user-hedra-secret" });
    expect(reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "media_generation",
      feature: "media.image",
      providerSource: "byok",
      provider: "hedra",
      model: "hedra-image-v1",
      metadata: expect.objectContaining({
        profileId: "hedra-main",
        hedraProfileId: "hedra-main",
      }),
    }));
    expect(generateAsset).toHaveBeenCalledWith(expect.objectContaining({
      type: "image",
      modelId: "hedra-image-v1",
      textPrompt: "Create a cover image.",
    }), { apiKey: "user-hedra-secret" });
    expect(inserted[0]).toMatchObject({
      type: "image",
      hedraGenerationId: "gen_1",
      hedraAssetId: "asset_1",
      meta: expect.objectContaining({
        provider: "hedra",
        providerSource: "byok",
        profileId: "hedra-main",
        hedraProfileId: "hedra-main",
      }),
    });
    expect(JSON.stringify(body)).not.toContain("user-hedra-secret");
    expect(completeUsageReservation).toHaveBeenCalledWith(reservation, {
      actualCredits: 2,
      providerRequestId: "gen_1",
    });
  });
});

describe("POST /api/hedra/assets hosted media BYOK", () => {
  it("uploads Hedra assets through an explicit saved hosted media profile", async () => {
    const reserveStorageBytes = vi.fn(async () => ({ id: "storage_1" }));
    const releaseStorageReservation = vi.fn();
    const requireByokProviderAccess = vi.fn(async () => ({}));
    const createAsset = vi.fn(async () => ({ id: "asset_1" }));
    const uploadAsset = vi.fn(async () => ({ id: "asset_1", name: "portrait.png" }));
    const getHedraProviderForUser = vi.fn(async () => ({
      provider: "hedra",
      apiKey: "user-hedra-secret",
      providerSource: "byok",
      profileId: "hedra-main",
    }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/mediaProviders", () => ({ getHedraProviderForUser }));
    vi.doMock("@/lib/hedra", () => ({ createAsset, uploadAsset }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveStorageBytes,
      releaseStorageReservation,
    }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      requireByokProviderAccess,
      requireManagedProviderAccess: vi.fn(),
    }));

    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "portrait.png", { type: "image/png" }));
    form.append("kind", "image");
    form.append("mediaProfileId", "hedra-main");

    const { POST } = await import("../app/api/hedra/assets/route");
    const res = await POST(new Request("http://test.local/api/hedra/assets", {
      method: "POST",
      body: form,
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ asset: { id: "asset_1", name: "portrait.png" } });
    expect(getHedraProviderForUser).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      process.env,
      "hedra-main",
    );
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(createAsset).toHaveBeenCalledWith({ name: "portrait.png", type: "image" }, { apiKey: "user-hedra-secret" });
    expect(uploadAsset).toHaveBeenCalledWith("asset_1", expect.any(File), "portrait.png", { apiKey: "user-hedra-secret" });
    expect(releaseStorageReservation).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("user-hedra-secret");
  });
});
