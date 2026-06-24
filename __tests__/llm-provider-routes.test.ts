import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function mockLocalRouteUser() {
  vi.doMock("@/lib/auth", () => ({
    requireUser: vi.fn(async () => ({ id: "local-user", workspaceId: "local-workspace", role: "author" })),
  }));
  vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
  vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess: vi.fn() }));
  vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile: vi.fn() }));
}

describe("hosted LLM provider utility routes", () => {
  it("filters and prioritizes OpenAI chat models when listing models", async () => {
    mockLocalRouteUser();
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "babbage-2" },
        { id: "text-embedding-3-large" },
        { id: "dall-e-3" },
        { id: "gpt-4o-mini" },
        { id: "gpt-4.1" },
        { id: "gpt-5-mini" },
        { id: "o3-mini" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        apiKey: "sk-openai-test",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toEqual(["gpt-5-mini", "gpt-4.1", "gpt-4o-mini", "o3-mini"]);
    expect(body.models).not.toContain("babbage-2");
    expect(body.models).not.toContain("text-embedding-3-large");
    expect(body.totalModels).toBe(7);
    expect(body.warning).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer sk-openai-test" }),
    }));
  });

  it("returns a readable OpenAI filtering warning without leaking API keys", async () => {
    mockLocalRouteUser();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "babbage-2" },
        { id: "davinci-002" },
        { id: "text-embedding-3-small" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        apiKey: "sk-openai-secret",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toEqual([]);
    expect(body.warning).toContain("none matched the ChatGPT chat-model filter");
    expect(JSON.stringify(body)).not.toContain("sk-openai-secret");
  });

  it("uses a saved desktop OpenAI media key to list chat models without reposting the key", async () => {
    mockLocalRouteUser();
    vi.doMock("@/lib/desktopSettings", () => ({
      desktopMediaProvider: vi.fn((provider: string) => provider === "openai"
        ? { apiKey: "sk-saved-openai", baseUrl: "https://api.openai.com/v1" }
        : null),
    }));
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "babbage-2" },
        { id: "gpt-4o-mini" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({ provider: "openai" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toEqual(["gpt-4o-mini"]);
    expect(body.models).not.toContain("babbage-2");
    expect(fetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer sk-saved-openai" }),
    }));
    expect(JSON.stringify(body)).not.toContain("sk-saved-openai");
  });

  it("uses a saved desktop OpenAI media key to test chat models without reposting the key", async () => {
    mockLocalRouteUser();
    vi.doMock("@/lib/desktopSettings", () => ({
      desktopMediaProvider: vi.fn((provider: string) => provider === "openai"
        ? { apiKey: "sk-saved-openai", baseUrl: "https://api.openai.com/v1" }
        : null),
    }));
    const createAIFromConfig = vi.fn(() => ({
      text: vi.fn(async () => "OK"),
    }));
    vi.doMock("@/lib/llm", async () => {
      const actual = await vi.importActual<any>("@/lib/llm");
      return { ...actual, createAIFromConfig };
    });

    const { POST } = await import("../app/api/llm/test/route");
    const res = await POST(new Request("http://test.local/api/llm/test", {
      method: "POST",
      body: JSON.stringify({ provider: "openai", model: "gpt-4o-mini" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, provider: "openai", model: "gpt-4o-mini", sample: "OK" });
    expect(createAIFromConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-saved-openai",
      baseUrl: "https://api.openai.com/v1",
    }));
    expect(JSON.stringify(body)).not.toContain("sk-saved-openai");
  });

  it("keeps provider listing errors readable without leaking OpenAI credentials", async () => {
    mockLocalRouteUser();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        message: "Bearer sk-openai-secret is invalid for this project",
      },
    }), { status: 401, headers: { "content-type": "application/json" } })));

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        apiKey: "sk-openai-secret",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("OpenAI rejected the API key. Reconnect the provider or paste a fresh key.");
    expect(JSON.stringify(body)).not.toContain("sk-openai-secret");
  });

  it("requires BYOK provider access before testing a hosted LLM profile", async () => {
    const getHostedProviderProfile = vi.fn();
    const createAIFromConfig = vi.fn();
    const requireByokProviderAccess = vi.fn(async () => {
      const { BillingError } = await import("@/lib/billing/stripe");
      throw new BillingError(402, "byok_provider_not_enabled", "Bring-your-own-key provider usage is not included in your current plan.");
    });

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile }));
    vi.doMock("@/lib/llm", async () => {
      const actual = await vi.importActual<any>("@/lib/llm");
      return { ...actual, createAIFromConfig };
    });

    const { POST } = await import("../app/api/llm/test/route");
    const res = await POST(new Request("http://test.local/api/llm/test", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        profileId: "openai-main",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "Bring-your-own-key provider usage is not included in your current plan.",
      code: "byok_provider_not_enabled",
    });
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(getHostedProviderProfile).not.toHaveBeenCalled();
    expect(createAIFromConfig).not.toHaveBeenCalled();
  });

  it("tests a local OpenAI-compatible provider without requiring an API key", async () => {
    const text = vi.fn(async () => " OK\n");
    const createAIFromConfig = vi.fn(() => ({ text }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local_user", role: "owner" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess: vi.fn() }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile: vi.fn() }));
    vi.doMock("@/lib/llm", async () => {
      const actual = await vi.importActual<any>("@/lib/llm");
      return { ...actual, createAIFromConfig };
    });

    const { POST } = await import("../app/api/llm/test/route");
    const res = await POST(new Request("http://test.local/api/llm/test", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai-compatible",
        model: "ai/gemma3",
        baseUrl: "http://localhost:12434/engines/v1/",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      provider: "openai-compatible",
      model: "ai/gemma3",
      sample: "OK",
    });
    expect(createAIFromConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai-compatible",
      model: "ai/gemma3",
      baseUrl: "http://localhost:12434/engines/v1",
      apiKey: undefined,
      maxTokens: 256,
    }));
    expect(text).toHaveBeenCalledWith("Reply with exactly OK. No punctuation, no extra words.");
  });

  it("tests a saved local provider profile without returning stored credentials", async () => {
    const text = vi.fn(async () => "OK");
    const createAIFromConfig = vi.fn(() => ({ text }));
    const getHostedProviderProfile = vi.fn(async () => ({
      id: "openai-main",
      label: "OpenAI Main",
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-saved-provider-secret",
    }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local_user", role: "owner" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess: vi.fn() }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile }));
    vi.doMock("@/lib/llm", async () => {
      const actual = await vi.importActual<any>("@/lib/llm");
      return { ...actual, createAIFromConfig };
    });

    const { POST } = await import("../app/api/llm/test/route");
    const res = await POST(new Request("http://test.local/api/llm/test", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        profileId: "openai-main",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      provider: "openai",
      model: "gpt-4o-mini",
      sample: "OK",
    });
    expect(getHostedProviderProfile).toHaveBeenCalledWith({ id: "local_user", role: "owner" }, "openai-main");
    expect(createAIFromConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      apiKey: "sk-saved-provider-secret",
    }));
    expect(JSON.stringify(body)).not.toContain("sk-saved-provider-secret");
  });

  it("returns a readable validation error before testing cloud providers without keys", async () => {
    const createAIFromConfig = vi.fn();

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local_user", role: "owner" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess: vi.fn() }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile: vi.fn() }));
    vi.doMock("@/lib/llm", async () => {
      const actual = await vi.importActual<any>("@/lib/llm");
      return { ...actual, createAIFromConfig };
    });

    const { POST } = await import("../app/api/llm/test/route");
    const res = await POST(new Request("http://test.local/api/llm/test", {
      method: "POST",
      body: JSON.stringify({
        provider: "gemini",
        model: "gemini-2.5-flash",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toEqual({
      error: "Add an API key before testing this provider.",
      code: "validation",
    });
    expect(createAIFromConfig).not.toHaveBeenCalled();
  });

  it("keeps provider test failures readable without leaking submitted credentials", async () => {
    const text = vi.fn(async () => {
      const { LLMError } = await import("@/lib/llm");
      throw new LLMError(
        401,
        "llm",
        "OpenAI rejected the API key. Reconnect the provider or paste a fresh key.",
        "openai",
        "Bearer sk-openai-provider-test-secret is invalid",
      );
    });
    const createAIFromConfig = vi.fn(() => ({ text }));

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local_user", role: "owner" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess: vi.fn() }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile: vi.fn() }));
    vi.doMock("@/lib/llm", async () => {
      const actual = await vi.importActual<any>("@/lib/llm");
      return { ...actual, createAIFromConfig };
    });

    const { POST } = await import("../app/api/llm/test/route");
    const res = await POST(new Request("http://test.local/api/llm/test", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-openai-provider-test-secret",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({
      error: "OpenAI rejected the API key. Reconnect the provider or paste a fresh key.",
      code: "llm",
    });
    expect(createAIFromConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      apiKey: "sk-openai-provider-test-secret",
      maxTokens: 256,
    }));
    expect(text).toHaveBeenCalledWith("Reply with exactly OK. No punctuation, no extra words.");
    expect(JSON.stringify(body)).not.toContain("sk-openai-provider-test-secret");
    expect(JSON.stringify(body)).not.toContain("Bearer");
  });

  it("requires BYOK provider access before listing hosted LLM models", async () => {
    const getHostedProviderProfile = vi.fn();
    const fetch = vi.fn();
    const requireByokProviderAccess = vi.fn(async () => {
      const { BillingError } = await import("@/lib/billing/stripe");
      throw new BillingError(402, "byok_provider_not_enabled", "Bring-your-own-key provider usage is not included in your current plan.");
    });
    vi.stubGlobal("fetch", fetch);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "user_1", workspaceId: "workspace_1", role: "author" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile }));

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai",
        profileId: "openai-main",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body).toEqual({
      error: "Bring-your-own-key provider usage is not included in your current plan.",
      code: "byok_provider_not_enabled",
    });
    expect(requireByokProviderAccess).toHaveBeenCalledWith({ id: "user_1", workspaceId: "workspace_1", role: "author" });
    expect(getHostedProviderProfile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lists local Ollama Gemma 4 models before other completion models", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({
          models: [
            { name: "llama3.2:latest" },
            { name: "gemma4:26b-mlx" },
            { name: "nomic-embed-text:latest", details: { family: "bert" } },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/show")) {
        const body = JSON.parse(String(init?.body || "{}"));
        return new Response(JSON.stringify({
          capabilities: body.model === "nomic-embed-text:latest" ? ["embedding"] : ["completion"],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error("Unexpected URL " + url);
    });
    vi.stubGlobal("fetch", fetch);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local_user", role: "owner" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess: vi.fn() }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile: vi.fn() }));

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toEqual(["gemma4:26b-mlx", "llama3.2:latest"]);
  });

  it("keeps Ollama tag models when show metadata is unavailable but still filters embedding names", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({
          models: [
            { name: "qwen2.5:latest" },
            { name: "mxbai-embed-large:latest" },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);

    vi.doMock("@/lib/auth", () => ({
      requireUser: vi.fn(async () => ({ id: "local_user", role: "owner" })),
    }));
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => true }));
    vi.doMock("@/lib/billing/entitlements", () => ({ requireByokProviderAccess: vi.fn() }));
    vi.doMock("@/lib/providerSettings", () => ({ getHostedProviderProfile: vi.fn() }));

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({ provider: "ollama" }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toEqual(["qwen2.5:latest"]);
  });

  it("lists Gemini generateContent models and strips models/ prefixes", async () => {
    mockLocalRouteUser();
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      models: [
        { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
        { name: "models/gemini-2.5-flash" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({
        provider: "gemini",
        apiKey: "gemini-key",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
    expect(fetch).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/v1beta/models", expect.objectContaining({
      headers: expect.objectContaining({ "x-goog-api-key": "gemini-key" }),
    }));
  });

  it("lists Docker Model Runner via OpenAI-compatible local base URL", async () => {
    mockLocalRouteUser();
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "ai/gemma3" }],
      models: [{ model: "ai/llama3.2" }, "ai/qwen2.5"],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    const { POST } = await import("../app/api/llm/models/route");
    const res = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({
        provider: "openai-compatible",
        baseUrl: "http://localhost:12434/engines/v1",
      }),
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toEqual(["ai/gemma3", "ai/llama3.2", "ai/qwen2.5"]);
    expect(fetch).toHaveBeenCalledWith("http://localhost:12434/engines/v1/models", expect.objectContaining({
      headers: { Accept: "application/json" },
    }));
  });

  it("lists xAI and Anthropic models with provider-specific auth headers", async () => {
    mockLocalRouteUser();
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify({
      data: url.includes("api.x.ai") ? [{ id: "grok-4.3" }] : undefined,
      models: url.includes("anthropic") ? [{ id: "claude-sonnet-4-5" }] : undefined,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    const { POST } = await import("../app/api/llm/models/route");
    const xai = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({ provider: "xai", apiKey: "xai-key" }),
    }));
    const anthropic = await POST(new Request("http://test.local/api/llm/models", {
      method: "POST",
      body: JSON.stringify({ provider: "anthropic", apiKey: "anthropic-key" }),
    }));

    expect(await xai.json()).toEqual({ models: ["grok-4.3"] });
    expect(await anthropic.json()).toEqual({ models: ["claude-sonnet-4-5"] });
    expect(fetch).toHaveBeenCalledWith("https://api.x.ai/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer xai-key" }),
    }));
    expect(fetch).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({
        "x-api-key": "anthropic-key",
        "anthropic-version": "2023-06-01",
      }),
    }));
  });
});
