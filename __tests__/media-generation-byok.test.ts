import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

function mockHostedGenerateBase() {
  const requireConcurrentJobCapacity = vi.fn(async () => undefined);
  const reserveUsage = vi.fn(async () => ({ id: "usage_1", workspaceId: "workspace_1", idempotencyKey: "idem_1" }));
  const completeUsageReservation = vi.fn(async () => undefined);
  const failUsageReservation = vi.fn(async () => undefined);
  const returning = vi.fn(async () => [{ id: "job_1", status: "completed", outputUrl: "https://storage.test/out" }]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));

  vi.doMock("@/lib/auth", () => ({
    requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
  }));
  vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
  vi.doMock("@/lib/desktopSettings", () => ({ desktopMediaProvider: vi.fn(() => null) }));
  vi.doMock("@/lib/tenant", () => ({
    campaignInWorkspace: vi.fn(async () => true),
    tenantNotFound: vi.fn(() => new Response(JSON.stringify({ error: "Not found.", code: "not_found" }), { status: 404 })),
  }));
  vi.doMock("@/lib/billing/entitlements", () => ({
    requireConcurrentJobCapacity,
    requireByokProviderAccess: vi.fn(async () => undefined),
    requireManagedProviderAccess: vi.fn(async () => undefined),
  }));
  vi.doMock("@/lib/billing/usage", () => ({
    reserveUsage,
    completeUsageReservation,
    failUsageReservation,
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
        insert,
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
  vi.doMock("@/lib/storage", () => ({
    uploadPublicAudio: vi.fn(async () => "https://storage.test/audio.mp3"),
    uploadPublicFile: vi.fn(async () => "https://storage.test/file.png"),
    persistRemoteImage: vi.fn(async () => "https://storage.test/image.png"),
    persistRemoteVideo: vi.fn(async () => "https://storage.test/video.mp4"),
  }));
  vi.doMock("@/lib/ai/imagePrompt", () => ({ craftImagePrompt: vi.fn() }));
  vi.doMock("@/lib/llm", () => ({ getAIForTaskForUser: vi.fn() }));
  vi.doMock("@/lib/refContext", () => ({ buildRefContext: vi.fn(() => "") }));

  return {
    requireConcurrentJobCapacity,
    reserveUsage,
    completeUsageReservation,
    failUsageReservation,
    insert,
    values,
  };
}

describe("hosted media BYOK generation", () => {
  it("generates OpenAI-compatible images with a saved hosted media profile and no env key", async () => {
    const base = mockHostedGenerateBase();
    const generateOpenAICompatibleImage = vi.fn(async () => ({
      outputUrl: "https://storage.test/image.png",
      downloadUrl: "https://storage.test/image.png",
      providerResponseId: "img_123",
    }));

    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile: vi.fn(async () => ({
        id: "openai-media",
        label: "OpenAI media",
        provider: "openai",
        model: "gpt-image-1",
        baseUrl: "https://api.openai.com/v1",
        hasApiKey: true,
        apiKey: "sk-user-openai-media",
      })),
      getHostedMediaProviderProfileForProvider: vi.fn(),
      getHostedMediaProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderProfile: vi.fn(),
      getHostedProviderProfileForProvider: vi.fn(),
      getHostedProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage }));
    vi.doMock("@/lib/mediaAudio", () => ({
      generateOpenAICompatibleSpeech: vi.fn(),
      synthesizeOpenAICompatibleSpeech: vi.fn(),
    }));
    vi.doMock("@/lib/hedra", () => ({
      listModels: vi.fn(),
      generateAsset: vi.fn(),
      createAsset: vi.fn(),
      uploadAsset: vi.fn(),
    }));
    vi.doMock("@/lib/elevenlabs", () => ({ textToSpeechLong: vi.fn() }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "image",
        provider: "openai",
        mediaProfileId: "openai-media",
        modelId: "gpt-image-1",
        prompt: "Create a simple editorial cover image.",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.job).toEqual({ id: "job_1", status: "completed", outputUrl: "https://storage.test/out" });
    expect(generateOpenAICompatibleImage).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        provider: "openai",
        apiKey: "sk-user-openai-media",
        baseUrl: "https://api.openai.com/v1",
        providerSource: "byok",
        profileId: "openai-media",
      },
      model: "gpt-image-1",
    }));
    expect(base.reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "media_generation",
      feature: "media.image",
      providerSource: "byok",
      provider: "openai",
      model: "gpt-image-1",
      metadata: { profileId: "openai-media" },
    }));
    expect(JSON.stringify(base.values.mock.calls)).not.toContain("sk-user-openai-media");
  });

  it("generates OpenAI audio by reusing a compatible hosted LLM BYOK profile", async () => {
    const base = mockHostedGenerateBase();
    const generateOpenAICompatibleSpeech = vi.fn(async () => ({
      outputUrl: "https://storage.test/audio.mp3",
      downloadUrl: "https://storage.test/audio.mp3",
      voice: "alloy",
    }));

    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile: vi.fn(async () => null),
      getHostedMediaProviderProfileForProvider: vi.fn(async () => null),
      getHostedMediaProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderProfile: vi.fn(async () => ({
        id: "openai-main",
        label: "OpenAI main",
        provider: "openai",
        model: "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
        hasApiKey: true,
        apiKey: "sk-user-openai-llm",
      })),
      getHostedProviderProfileForProvider: vi.fn(),
      getHostedProviderSettings: vi.fn(),
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

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "audio",
        provider: "openai",
        mediaProfileId: "openai-main",
        modelId: "gpt-4o-mini-tts",
        prompt: "Read this aloud.",
        script: "A short Pillar Press voice test.",
        voiceId: "alloy",
      }),
    }));

    expect(res.status).toBe(201);
    expect(generateOpenAICompatibleSpeech).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        provider: "openai",
        apiKey: "sk-user-openai-llm",
        baseUrl: "https://api.openai.com/v1",
        providerSource: "byok",
        profileId: "openai-main",
      },
      model: "gpt-4o-mini-tts",
    }));
    expect(base.reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "media_generation",
      feature: "media.audio",
      providerSource: "byok",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      metadata: { profileId: "openai-main" },
    }));
    expect(JSON.stringify(base.values.mock.calls)).not.toContain("sk-user-openai-llm");
  });

  it("generates Hedra media with a saved hosted Hedra profile and stores only secret-free metadata", async () => {
    const base = mockHostedGenerateBase();
    const listModels = vi.fn(async () => [{
      id: "hedra-image-v1",
      name: "Hedra Image",
      type: "image",
      credits: 1,
    }]);
    const generateAsset = vi.fn(async () => ({
      id: "gen_123",
      asset_id: "asset_123",
      status: "processing",
      progress: 0.1,
    }));

    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile: vi.fn(async () => ({
        id: "hedra-main",
        label: "Hedra main",
        provider: "hedra",
        model: "hedra-image-v1",
        hasApiKey: true,
        apiKey: "sk-user-hedra",
      })),
      getHostedMediaProviderProfileForProvider: vi.fn(),
      getHostedMediaProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderProfile: vi.fn(),
      getHostedProviderProfileForProvider: vi.fn(),
      getHostedProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage: vi.fn() }));
    vi.doMock("@/lib/mediaAudio", () => ({
      generateOpenAICompatibleSpeech: vi.fn(),
      synthesizeOpenAICompatibleSpeech: vi.fn(),
    }));
    vi.doMock("@/lib/hedra", () => ({
      listModels,
      generateAsset,
      createAsset: vi.fn(),
      uploadAsset: vi.fn(),
    }));
    vi.doMock("@/lib/elevenlabs", () => ({ textToSpeechLong: vi.fn() }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "image",
        provider: "hedra",
        mediaProfileId: "hedra-main",
        modelId: "hedra-image-v1",
        prompt: "Create a Pillar Press hero image.",
        enhance: false,
      }),
    }));

    expect(res.status).toBe(201);
    expect(listModels).toHaveBeenCalledWith(["image"], { apiKey: "sk-user-hedra" });
    expect(generateAsset).toHaveBeenCalledWith(expect.objectContaining({
      type: "image",
      modelId: "hedra-image-v1",
      textPrompt: "Create a Pillar Press hero image.",
    }), { apiKey: "sk-user-hedra" });
    expect(base.reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "media_generation",
      feature: "media.image",
      providerSource: "byok",
      provider: "hedra",
      model: "hedra-image-v1",
      metadata: {
        profileId: "hedra-main",
        hedraProfileId: "hedra-main",
      },
    }));
    expect(base.values).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        provider: "hedra",
        providerSource: "byok",
        profileId: "hedra-main",
        hedraProfileId: "hedra-main",
      }),
      hedraGenerationId: "gen_123",
      hedraAssetId: "asset_123",
    }));
    expect(JSON.stringify(base.values.mock.calls)).not.toContain("sk-user-hedra");
  });

  it("generates Hedra avatar video with a saved ElevenLabs voiceover profile", async () => {
    const base = mockHostedGenerateBase();
    const listModels = vi.fn(async () => [{
      id: "hedra-avatar-v1",
      name: "Hedra Avatar",
      type: "video",
      credits: 4,
    }]);
    const textToSpeechLong = vi.fn(async () => Buffer.from("avatar voiceover"));
    const createAsset = vi.fn(async () => ({ id: "voice_asset_1" }));
    const uploadAsset = vi.fn(async () => ({ id: "voice_asset_1" }));
    const generateAsset = vi.fn(async () => ({
      id: "gen_avatar",
      asset_id: "avatar_asset_1",
      status: "queued",
      progress: 0,
    }));

    vi.doMock("@/lib/mediaProviderSettings", () => ({
      getHostedMediaProviderProfile: vi.fn(async () => null),
      getHostedMediaProviderProfileForProvider: vi.fn(),
      getHostedMediaProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderProfile: vi.fn(),
      getHostedProviderProfileForProvider: vi.fn(),
      getHostedProviderSettings: vi.fn(),
    }));
    vi.doMock("@/lib/mediaProviders", () => ({
      getImageProviderForUser: vi.fn(async () => null),
      getAudioProviderForUser: vi.fn(async () => null),
      getElevenLabsProviderForUser: vi.fn(async () => ({
        provider: "elevenlabs",
        apiKey: "eleven-avatar-secret",
        providerSource: "byok",
        profileId: "eleven-avatar",
      })),
      getHedraProviderForUser: vi.fn(async () => ({
        provider: "hedra",
        apiKey: "hedra-avatar-secret",
        providerSource: "byok",
        profileId: "hedra-avatar",
      })),
    }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage: vi.fn() }));
    vi.doMock("@/lib/mediaAudio", () => ({
      generateOpenAICompatibleSpeech: vi.fn(),
      synthesizeOpenAICompatibleSpeech: vi.fn(),
    }));
    vi.doMock("@/lib/hedra", () => ({ listModels, generateAsset, createAsset, uploadAsset }));
    vi.doMock("@/lib/elevenlabs", () => ({ textToSpeechLong }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "avatar_video",
        provider: "hedra",
        mediaProfileId: "hedra-avatar",
        audioMediaProfileId: "eleven-avatar",
        modelId: "hedra-avatar-v1",
        prompt: "A warm editorial host in a simple studio.",
        script: "Welcome to this Pillar Press update.",
        voiceId: "voice_1",
      }),
    }));

    expect(res.status).toBe(201);
    expect(textToSpeechLong).toHaveBeenCalledWith({
      text: "Welcome to this Pillar Press update.",
      voiceId: "voice_1",
      apiKey: "eleven-avatar-secret",
    });
    expect(createAsset).toHaveBeenCalledWith({ name: expect.stringMatching(/^voiceover-/), type: "audio" }, { apiKey: "hedra-avatar-secret" });
    expect(uploadAsset).toHaveBeenCalledWith("voice_asset_1", expect.any(Blob), expect.stringMatching(/^voiceover-/), { apiKey: "hedra-avatar-secret" });
    expect(generateAsset).toHaveBeenCalledWith(expect.objectContaining({
      type: "video",
      modelId: "hedra-avatar-v1",
      textPrompt: "A warm editorial host in a simple studio.",
      audioAssetId: "voice_asset_1",
    }), { apiKey: "hedra-avatar-secret" });
    expect(base.reserveUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "media_generation",
      feature: "media.avatar_video",
      providerSource: "byok",
      provider: "hedra",
      model: "hedra-avatar-v1",
      metadata: expect.objectContaining({
        profileId: "hedra-avatar",
        hedraProfileId: "hedra-avatar",
        elevenlabsProfileId: "eleven-avatar",
      }),
    }));
    expect(base.values).toHaveBeenCalledWith(expect.objectContaining({
      type: "avatar_video",
      elevenAudioAssetId: "voice_asset_1",
      meta: expect.objectContaining({
        provider: "hedra",
        providerSource: "byok",
        profileId: "hedra-avatar",
        hedraProfileId: "hedra-avatar",
        elevenlabsProfileId: "eleven-avatar",
      }),
    }));
    expect(JSON.stringify(base.values.mock.calls)).not.toContain("hedra-avatar-secret");
    expect(JSON.stringify(base.values.mock.calls)).not.toContain("eleven-avatar-secret");
    expect(base.completeUsageReservation).toHaveBeenCalledWith(expect.anything(), {
      actualCredits: 4,
      providerRequestId: "gen_avatar",
    });
  });
});

describe("local-first audio generation", () => {
  it("saves audio with the macOS system voice when no cloud audio provider is configured", async () => {
    const createLocalMediaJob = vi.fn((input) => ({
      id: "local_audio_1",
      ...input,
      meta: input.meta,
    }));
    const synthesizeLocalSystemSpeech = vi.fn(async () => ({
      bytes: Buffer.from("aiff-bytes"),
      contentType: "audio/aiff",
      extension: "aiff",
      voice: "system-default",
    }));
    const writeLocalPublicFile = vi.fn(() => "/api/local-files/voice/audio.aiff?contentType=audio%2Faiff");

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local-owner", workspaceId: "local-workspace", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/tenant", () => ({
      campaignInWorkspace: vi.fn(async () => true),
      tenantNotFound: vi.fn(() => new Response(JSON.stringify({ error: "Not found.", code: "not_found" }), { status: 404 })),
    }));
    vi.doMock("@/lib/local/database", () => ({
      createLocalMediaJob,
      getLocalMediaJob: vi.fn(),
      getLocalPiece: vi.fn(),
      getLocalReferences: vi.fn(),
      getLocalStyleProfile: vi.fn(),
    }));
    vi.doMock("@/lib/mediaProviders", () => ({
      getAudioProviderForUser: vi.fn(async () => null),
      getElevenLabsProviderForUser: vi.fn(async () => null),
      getHedraProviderForUser: vi.fn(async () => null),
      getImageProviderForUser: vi.fn(async () => null),
    }));
    vi.doMock("@/lib/local/systemAudio", () => ({ synthesizeLocalSystemSpeech }));
    vi.doMock("@/lib/local/storage", () => ({ writeLocalPublicFile }));
    vi.doMock("@/lib/billing/entitlements", () => ({
      requireConcurrentJobCapacity: vi.fn(),
      requireByokProviderAccess: vi.fn(),
      requireManagedProviderAccess: vi.fn(),
    }));
    vi.doMock("@/lib/billing/usage", () => ({
      reserveUsage: vi.fn(),
      completeUsageReservation: vi.fn(),
      failUsageReservation: vi.fn(),
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
    vi.doMock("@/lib/storage", () => ({
      uploadPublicAudio: vi.fn(),
      uploadPublicFile: vi.fn(),
      persistRemoteImage: vi.fn(),
      persistRemoteVideo: vi.fn(),
    }));
    vi.doMock("@/lib/ai/imagePrompt", () => ({ craftImagePrompt: vi.fn() }));
    vi.doMock("@/lib/llm", () => ({ getAIForTaskForUser: vi.fn() }));
    vi.doMock("@/lib/refContext", () => ({ buildRefContext: vi.fn(() => "") }));
    vi.doMock("@/lib/mediaImage", () => ({ generateOpenAICompatibleImage: vi.fn() }));
    vi.doMock("@/lib/mediaAudio", () => ({
      generateOpenAICompatibleSpeech: vi.fn(),
      synthesizeOpenAICompatibleSpeech: vi.fn(),
    }));
    vi.doMock("@/lib/hedra", () => ({
      listModels: vi.fn(),
      generateAsset: vi.fn(),
      createAsset: vi.fn(),
      uploadAsset: vi.fn(),
    }));
    vi.doMock("@/lib/elevenlabs", () => ({ textToSpeechLong: vi.fn() }));

    const { POST } = await import("../app/api/hedra/generate/route");
    const res = await POST(new Request("http://test.local/api/hedra/generate", {
      method: "POST",
      body: JSON.stringify({
        type: "audio",
        provider: "local-system",
        modelId: "macos-system-voice",
        prompt: "Read this local audio sample.",
        script: "Read this local audio sample.",
        voiceId: "system-default",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(synthesizeLocalSystemSpeech).toHaveBeenCalledWith({
      text: "Read this local audio sample.",
      voice: "system-default",
    });
    expect(writeLocalPublicFile).toHaveBeenCalledWith(
      Buffer.from("aiff-bytes"),
      expect.stringMatching(/^voiceover-\d+\.aiff$/),
      "audio/aiff",
      "voice",
    );
    expect(createLocalMediaJob).toHaveBeenCalledWith(expect.objectContaining({
      userId: "local-owner",
      type: "audio",
      modelId: "macos-system-voice",
      modelName: "macOS System Voice",
      outputUrl: "/api/local-files/voice/audio.aiff?contentType=audio%2Faiff",
      downloadUrl: "/api/local-files/voice/audio.aiff?contentType=audio%2Faiff",
      meta: expect.objectContaining({
        provider: "local-system",
        providerSource: "local",
        contentType: "audio/aiff",
        extension: "aiff",
      }),
    }));
    expect(body.job.meta.provider).toBe("local-system");
    expect(JSON.stringify(body)).not.toContain("sk-");
  });
});
