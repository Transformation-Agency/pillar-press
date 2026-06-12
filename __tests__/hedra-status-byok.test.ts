import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("GET /api/hedra/status/[id] hosted BYOK polling", () => {
  it("polls and resolves completed Hedra jobs with the saved Hedra BYOK profile", async () => {
    const getHostedMediaProviderProfile = vi.fn(async () => ({
      id: "hedra-main",
      label: "Hedra",
      provider: "hedra",
      hasApiKey: true,
      apiKey: "user-hedra-secret",
    }));
    const getGenerationStatus = vi.fn(async () => ({
      id: "gen_1",
      status: "completed",
      progress: 1,
      asset_id: "asset_1",
    }));
    const getAssetUrls = vi.fn(async () => ({
      url: "https://hedra-cdn.test/rendered.png",
      thumbnailUrl: "https://hedra-cdn.test/thumb.png",
    }));
    const persistRemoteImage = vi.fn(async () => "https://storage.test/job_1.png");
    const returning = vi.fn(async () => [{
      id: "job_1",
      status: "completed",
      outputUrl: "https://storage.test/job_1.png",
    }]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const findFirst = vi.fn(async () => ({
      id: "job_1",
      userId: "user_1",
      workspaceId: "workspace_1",
      type: "image",
      status: "processing",
      progress: 20,
      hedraGenerationId: "gen_1",
      hedraAssetId: null,
      outputUrl: null,
      downloadUrl: null,
      thumbnailUrl: null,
      errorMessage: null,
      completedAt: null,
      meta: {
        provider: "hedra",
        providerSource: "byok",
        profileId: "hedra-main",
        hedraProfileId: "hedra-main",
      },
    }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return {
        ...actual,
        db: {
          query: { mediaJobs: { findFirst } },
          update,
        },
      };
    });
    vi.doMock("@/lib/local/database", () => ({
      getLocalMediaJob: vi.fn(),
      updateLocalMediaJob: vi.fn(),
    }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({ getHostedMediaProviderProfile }));
    vi.doMock("@/lib/hedra", async () => {
      const actual = await vi.importActual<any>("@/lib/hedra");
      return {
        ...actual,
        getGenerationStatus,
        getAssetUrls,
      };
    });
    vi.doMock("@/lib/storage", () => ({
      persistRemoteImage,
      persistRemoteVideo: vi.fn(),
    }));

    const { GET } = await import("../app/api/hedra/status/[id]/route");
    const res = await GET(new Request("http://test.local/api/hedra/status/job_1"), {
      params: Promise.resolve({ id: "job_1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getHostedMediaProviderProfile).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      "hedra-main",
    );
    expect(getGenerationStatus).toHaveBeenCalledWith("gen_1", { apiKey: "user-hedra-secret" });
    expect(getAssetUrls).toHaveBeenCalledWith("asset_1", "image", { apiKey: "user-hedra-secret" });
    expect(persistRemoteImage).toHaveBeenCalledWith(
      "https://hedra-cdn.test/rendered.png",
      "job_1",
      { user: { id: "user_1", workspaceId: "workspace_1", role: "author" } },
    );
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      outputUrl: "https://storage.test/job_1.png",
      downloadUrl: "https://storage.test/job_1.png",
      thumbnailUrl: "https://storage.test/job_1.png",
      hedraAssetId: "asset_1",
    }));
    expect(body).toEqual({
      job: {
        id: "job_1",
        status: "completed",
        outputUrl: "https://storage.test/job_1.png",
      },
    });
    expect(JSON.stringify(body)).not.toContain("user-hedra-secret");
  });

  it("does not send a non-Hedra saved media key to Hedra when polling BYOK jobs", async () => {
    const getHostedMediaProviderProfile = vi.fn(async () => ({
      id: "openai-media",
      label: "OpenAI media",
      provider: "openai",
      hasApiKey: true,
      apiKey: "sk-openai-media-secret",
    }));
    const getGenerationStatus = vi.fn();
    const findFirst = vi.fn(async () => ({
      id: "job_1",
      userId: "user_1",
      workspaceId: "workspace_1",
      type: "image",
      status: "processing",
      progress: 20,
      hedraGenerationId: "gen_1",
      meta: {
        provider: "hedra",
        providerSource: "byok",
        profileId: "openai-media",
        hedraProfileId: "openai-media",
      },
    }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/db", async () => {
      const actual = await vi.importActual<any>("@/lib/db");
      return {
        ...actual,
        db: {
          query: { mediaJobs: { findFirst } },
          update: vi.fn(),
        },
      };
    });
    vi.doMock("@/lib/local/database", () => ({
      getLocalMediaJob: vi.fn(),
      updateLocalMediaJob: vi.fn(),
    }));
    vi.doMock("@/lib/mediaProviderSettings", () => ({ getHostedMediaProviderProfile }));
    vi.doMock("@/lib/hedra", async () => {
      const actual = await vi.importActual<any>("@/lib/hedra");
      return {
        ...actual,
        getGenerationStatus,
        getAssetUrls: vi.fn(),
      };
    });
    vi.doMock("@/lib/storage", () => ({
      persistRemoteImage: vi.fn(),
      persistRemoteVideo: vi.fn(),
    }));

    const { GET } = await import("../app/api/hedra/status/[id]/route");
    const res = await GET(new Request("http://test.local/api/hedra/status/job_1"), {
      params: Promise.resolve({ id: "job_1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "Reconnect the Hedra media provider for this generation.",
      code: "media_provider_unavailable",
    });
    expect(getHostedMediaProviderProfile).toHaveBeenCalledWith(
      { id: "user_1", workspaceId: "workspace_1", role: "author" },
      "openai-media",
    );
    expect(getGenerationStatus).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("sk-openai-media-secret");
  });
});
