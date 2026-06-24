import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible image generation payloads", () => {
  it("sends xAI Imagine image parameters instead of OpenAI size", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      data: [{ url: "https://images.test/xai.png" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("@/lib/storage", () => ({
      uploadPublicFile: vi.fn(),
      persistRemoteImage: vi.fn(async () => "local://image/xai.png"),
    }));

    const { generateOpenAICompatibleImage } = await import("@/lib/mediaImage");
    await generateOpenAICompatibleImage({
      config: {
        provider: "xai",
        apiKey: "xai-secret",
        baseUrl: "https://api.x.ai/v1",
      },
      model: "grok-imagine-image-quality",
      prompt: "A simple editorial desk.",
      aspectRatio: "16:9",
      resolution: "1024x1024",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(init?.body || "{}"));
    expect(fetchMock).toHaveBeenCalledWith("https://api.x.ai/v1/images/generations", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer xai-secret" }),
    }));
    expect(requestBody).toMatchObject({
      model: "grok-imagine-image-quality",
      prompt: "A simple editorial desk.",
      n: 1,
      aspect_ratio: "16:9",
      resolution: "1k",
    });
    expect(requestBody).not.toHaveProperty("size");
  });

  it("keeps OpenAI image requests on the size parameter", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      data: [{ url: "https://images.test/openai.png" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.doMock("@/lib/storage", () => ({
      uploadPublicFile: vi.fn(),
      persistRemoteImage: vi.fn(async () => "local://image/openai.png"),
    }));

    const { generateOpenAICompatibleImage } = await import("@/lib/mediaImage");
    await generateOpenAICompatibleImage({
      config: {
        provider: "openai",
        apiKey: "sk-openai",
        baseUrl: "https://api.openai.com/v1",
      },
      model: "gpt-image-1",
      prompt: "A simple editorial desk.",
      aspectRatio: "16:9",
      resolution: "auto",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const requestBody = JSON.parse(String(init?.body || "{}"));
    expect(requestBody).toMatchObject({
      model: "gpt-image-1",
      prompt: "A simple editorial desk.",
      n: 1,
      size: "1536x1024",
    });
    expect(requestBody).not.toHaveProperty("aspect_ratio");
  });
});
