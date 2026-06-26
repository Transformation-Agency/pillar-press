import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createCipheriv } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAI, createAIFromConfig, LLMError, type LLMAdapter } from "@/lib/llm";
import { resolveMainLLMConfig, resolveTaskLLMConfig, publicLLMStatus } from "@/lib/llm/config";
import { geminiProvider } from "@/lib/llm/providers/gemini";
import { estimatedModelContextWindow, fallbackContextWindow } from "@/lib/llm/context";
import { openAICompatibleProvider, openAIProvider } from "@/lib/llm/providers/openaiCompatible";
import { ollamaProvider } from "@/lib/llm/providers/ollama";
import { toErrorResponse } from "@/lib/errors";

function encryptDesktopSecret(value: string, keyText = Buffer.alloc(32, 7).toString("base64")) {
  const key = Buffer.from(keyText, "base64");
  const nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return {
    keyText,
    encrypted: `kpenc:v1:${nonce.toString("base64")}:${ciphertext.toString("base64")}`,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/local/mode");
  vi.doUnmock("@/lib/providerSettings");
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("User-scoped LLM resolver", () => {
  it("uses hosted saved task profiles as BYOK providers", async () => {
    vi.resetModules();
    vi.doMock("@/lib/local/mode", () => ({ isLocalFirstMode: () => false }));
    vi.doMock("@/lib/providerSettings", () => ({
      getHostedProviderSettings: vi.fn(async () => ({
        defaultProfileId: "default-profile",
        taskDefaults: { review: "review-profile" },
      })),
      getHostedProviderProfile: vi.fn(async (_user, profileId: string) => ({
        id: profileId,
        provider: "openai",
        model: profileId === "review-profile" ? "gpt-4o" : "gpt-4o-mini",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-openai",
      })),
    }));

    const { getAIForTaskForUser } = await import("@/lib/llm");
    const resolved = await getAIForTaskForUser("review", {
      id: "user_1",
      workspaceId: "workspace_1",
      role: "author",
    });

    expect(resolved).toMatchObject({
      providerSource: "byok",
      provider: "openai",
      model: "gpt-4o",
      profileId: "review-profile",
    });
    expect(resolved.ai).toBeTruthy();
  });
});

describe("LLM config", () => {
  it("estimates context windows from the selected model, not only the provider", () => {
    expect(estimatedModelContextWindow({ provider: "openai", model: "gpt-5.2" })).toBe(128000);
    expect(estimatedModelContextWindow({ provider: "openai", model: "gpt-4" })).toBe(8192);
    expect(estimatedModelContextWindow({ provider: "anthropic", model: "claude-haiku-4-5" })).toBe(200000);
    expect(estimatedModelContextWindow({ provider: "gemini", model: "gemini-2.5-flash" })).toBe(1000000);
    expect(estimatedModelContextWindow({ provider: "xai", model: "grok-4.3" })).toBe(256000);
    expect(estimatedModelContextWindow({ provider: "ollama", model: "qwen2.5:7b" })).toBeNull();
    expect(estimatedModelContextWindow({ provider: "ollama", model: "qwen2.5-32k:7b" })).toBe(32000);
    expect(fallbackContextWindow({ provider: "ollama", model: "qwen2.5:7b" })).toBe(8192);
  });

  it("keeps Anthropic backward compatibility when only ANTHROPIC_API_KEY is set", () => {
    const cfg = resolveMainLLMConfig({ ANTHROPIC_API_KEY: "sk-ant" });
    expect(cfg).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      apiKey: "sk-ant",
      maxTokens: 32000,
    });
  });

  it("resolves Ollama defaults for local native chat", () => {
    const cfg = resolveMainLLMConfig({ LLM_PROVIDER: "ollama", LLM_MODEL: "llama3.2" });
    expect(cfg).toMatchObject({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
    });
  });

  it("uses the larger local Gemma 4 Ollama context budget", async () => {
    const { llmBudgetForResolvedTask } = await import("@/lib/llm/budget");

    expect(llmBudgetForResolvedTask({ provider: "ollama", model: "gemma4:26b-mlx" })).toEqual({
      contextTokens: 192000,
      responseReserve: 8000,
    });
    expect(llmBudgetForResolvedTask({ provider: "ollama", model: "llama3.2:latest" })).toEqual({
      contextTokens: 24000,
      responseReserve: 4000,
    });
  });

  it("resolves first-class optional cloud providers", () => {
    expect(resolveMainLLMConfig({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o-mini",
      OPENAI_API_KEY: "sk-openai",
    })).toMatchObject({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-openai",
    });

    expect(resolveMainLLMConfig({
      LLM_PROVIDER: "xai",
      LLM_MODEL: "grok-4.3",
      XAI_API_KEY: "xai-key",
    })).toMatchObject({
      provider: "xai",
      baseUrl: "https://api.x.ai/v1",
      apiKey: "xai-key",
    });

    expect(resolveMainLLMConfig({
      LLM_PROVIDER: "gemini",
      GEMINI_API_KEY: "gem-key",
    })).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gem-key",
    });
  });

  it("uses the saved desktop model choice for local-first Ollama", () => {
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({ model: "mistral-small:latest" }));
    try {
      const cfg = resolveMainLLMConfig({
        PILLAR_PRESS_LOCAL_FIRST: "true",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
      });
      expect(cfg).toMatchObject({
        provider: "ollama",
        model: "mistral-small:latest",
        baseUrl: "http://127.0.0.1:11434",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores desktop local defaults when hosted web mode is explicit", () => {
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({ model: "mistral-small:latest" }));
    try {
      const cfg = resolveMainLLMConfig({
        PILLAR_PRESS_RUNTIME: "hosted",
        PILLAR_PRESS_LOCAL_FIRST: "true",
        DATA_BACKEND: "sqlite",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-4o-mini",
        OPENAI_API_KEY: "sk-openai",
      });
      expect(cfg).toMatchObject({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-openai",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses saved desktop provider settings for local-first OpenAI-compatible endpoints", () => {
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      provider: "openai-compatible",
      model: "ai/smollm2",
      baseUrl: "http://localhost:12434/engines/v1",
      apiKey: "local-key",
    }));
    try {
      const cfg = resolveMainLLMConfig({
        PILLAR_PRESS_LOCAL_FIRST: "true",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
      });
      expect(cfg).toMatchObject({
        provider: "openai-compatible",
        model: "ai/smollm2",
        baseUrl: "http://localhost:12434/engines/v1",
        apiKey: "local-key",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves per-task desktop profile defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      profiles: [
        {
          id: "local",
          label: "Local gather",
          provider: "ollama",
          model: "llama3.2",
          baseUrl: "http://127.0.0.1:11434",
        },
        {
          id: "draft-cloud",
          label: "Draft ChatGPT",
          provider: "openai",
          model: "gpt-4o-mini",
          apiKey: "sk-openai",
        },
        {
          id: "review-grok",
          label: "Review Grok",
          provider: "xai",
          model: "grok-4.3",
          apiKey: "xai-secret",
        },
      ],
      defaultProfileId: "local",
      taskDefaults: {
        gather: "local",
        weave: "local",
        draft: "draft-cloud",
        review: "review-grok",
      },
    }));
    try {
      expect(resolveTaskLLMConfig("gather", {
        PILLAR_PRESS_LOCAL_FIRST: "true",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
      })).toMatchObject({
        provider: "ollama",
        model: "llama3.2",
      });
      expect(resolveTaskLLMConfig("draft", {
        PILLAR_PRESS_LOCAL_FIRST: "true",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
      })).toMatchObject({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-openai",
        baseUrl: "https://api.openai.com/v1",
      });
      expect(resolveTaskLLMConfig("review", {
        PILLAR_PRESS_LOCAL_FIRST: "true",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
      })).toMatchObject({
        provider: "xai",
        model: "grok-4.3",
        apiKey: "xai-secret",
        baseUrl: "https://api.x.ai/v1",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("decrypts encrypted desktop provider keys with the runtime desktop key", () => {
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    const secret = encryptDesktopSecret("sk-encrypted-openai");
    writeFileSync(settingsPath, JSON.stringify({
      profiles: [{
        id: "draft-cloud",
        label: "Draft ChatGPT",
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: secret.encrypted,
      }],
      defaultProfileId: "draft-cloud",
    }));
    try {
      const cfg = resolveMainLLMConfig({
        PILLAR_PRESS_LOCAL_FIRST: "true",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
        PILLAR_PRESS_DESKTOP_SETTINGS_KEY: secret.keyText,
      });
      expect(cfg).toMatchObject({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-encrypted-openai",
      });
      const status = publicLLMStatus({
        PILLAR_PRESS_LOCAL_FIRST: "true",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
        PILLAR_PRESS_DESKTOP_SETTINGS_KEY: secret.keyText,
      });
      expect(JSON.stringify(status)).not.toContain("sk-encrypted-openai");
      expect(JSON.stringify(status)).not.toContain(secret.encrypted);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets task env overrides win over desktop defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      profiles: [{ id: "local", provider: "ollama", model: "llama3.2" }],
      defaultProfileId: "local",
      taskDefaults: { review: "local" },
    }));
    try {
      expect(resolveTaskLLMConfig("review", {
        PILLAR_PRESS_LOCAL_FIRST: "true",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
        LLM_TASK_REVIEW_PROVIDER: "anthropic",
        LLM_TASK_REVIEW_MODEL: "claude-haiku-4-5",
        LLM_TASK_REVIEW_API_KEY: "sk-ant",
      })).toMatchObject({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        apiKey: "sk-ant",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports public status without secrets", () => {
    const status = publicLLMStatus({
      LLM_PROVIDER: "openai-compatible",
      LLM_MODEL: "local-model",
      LLM_BASE_URL: "http://localhost:1234/v1",
      LLM_API_KEY: "secret",
      ANTHROPIC_API_KEY: "file-secret",
    });
    expect(status).toMatchObject({
      provider: "openai-compatible",
      model: "local-model",
      fileProvider: "anthropic",
      fileModel: "claude-haiku-4-5",
    });
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("reports task profile status without leaking desktop profile keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "pillar-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      profiles: [
        { id: "local", label: "Local", provider: "ollama", model: "llama3.2" },
        { id: "anthropic-review", label: "Review", provider: "anthropic", model: "claude-haiku-4-5", apiKey: "sk-secret" },
      ],
      defaultProfileId: "local",
      taskDefaults: { review: "anthropic-review" },
    }));
    try {
      const status = publicLLMStatus({
        PILLAR_PRESS_LOCAL_FIRST: "true",
        PILLAR_PRESS_LLM_SETTINGS_PATH: settingsPath,
      });
      expect(status).toMatchObject({
        provider: "ollama",
        model: "llama3.2",
        defaultProfileId: "local",
      });
      expect(status.profiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "anthropic-review", hasApiKey: true, contextWindow: 200000 }),
      ]));
      expect(status.tasks.review).toMatchObject({
        profileId: "anthropic-review",
        provider: "anthropic",
        model: "claude-haiku-4-5",
      });
      expect(JSON.stringify(status)).not.toContain("sk-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports local-first status before an Ollama model is selected", () => {
    const status = publicLLMStatus({
      PILLAR_PRESS_LOCAL_FIRST: "true",
      LLM_PROVIDER: "ollama",
      LLM_BASE_URL: "http://127.0.0.1:11434",
    });
    expect(status).toMatchObject({
      provider: "ollama",
      model: null,
      fileProvider: null,
      fileModel: null,
      capabilities: {
        text: true,
        json: true,
        vision: false,
        pdf: false,
      },
    });
  });
});

describe("provider adapters", () => {
  it("sends OpenAI-compatible chat completions with optional bearer auth", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "hello" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = openAICompatibleProvider({
      provider: "openai-compatible",
      model: "gpt-local",
      baseUrl: "http://localhost:1234/v1/",
      apiKey: "key",
      maxTokens: 123,
    });
    await expect(adapter.complete([{ role: "user", content: "hi" }])).resolves.toBe("hello");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:1234/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
        body: JSON.stringify({
          model: "gpt-local",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 123,
        }),
      }),
    );
  });

  it("sends OpenAI through the Responses API", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: "openai hello" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const openai = openAIProvider({
      provider: "openai",
      model: "gpt-5.2",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-key",
      maxTokens: 100,
    });
    await expect(openai.complete([{ role: "user", content: "hi" }])).resolves.toBe("openai hello");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer openai-key" }),
        body: JSON.stringify({
          model: "gpt-5.2",
          input: [{ role: "user", content: "hi" }],
          max_output_tokens: 100,
        }),
      }),
    );
  });

  it("opts OpenAI Desk calls into hosted web search", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: "searched" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const openai = openAIProvider({
      provider: "openai",
      model: "gpt-5.2",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-key",
      maxTokens: 100,
    });
    await expect(openai.complete([{ role: "user", content: "fact check this" }], { webSearch: true })).resolves.toBe("searched");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        body: JSON.stringify({
          model: "gpt-5.2",
          input: [{ role: "user", content: "fact check this" }],
          max_output_tokens: 100,
          tools: [{ type: "web_search", search_context_size: "low" }],
          tool_choice: "auto",
        }),
      }),
    );
  });

  it("keeps xAI on the chat completions transport", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "cloud hello" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const xai = openAICompatibleProvider({
      provider: "xai",
      model: "grok-4.3",
      baseUrl: "https://api.x.ai/v1",
      apiKey: "xai-key",
      maxTokens: 200,
    });
    await expect(xai.complete([{ role: "user", content: "hi" }])).resolves.toBe("cloud hello");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.x.ai/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer xai-key" }),
      }),
    );
  });

  it("uses xAI Responses web search when requested", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: "grok searched" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const xai = openAICompatibleProvider({
      provider: "xai",
      model: "grok-4.3",
      baseUrl: "https://api.x.ai/v1",
      apiKey: "xai-key",
      maxTokens: 200,
    });
    await expect(xai.complete([{ role: "user", content: "search this" }], { webSearch: true })).resolves.toBe("grok searched");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.x.ai/v1/responses",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer xai-key" }),
        body: JSON.stringify({
          model: "grok-4.3",
          input: [{ role: "user", content: "search this" }],
          max_output_tokens: 200,
          tools: [{ type: "web_search" }],
          tool_choice: "auto",
        }),
      }),
    );
  });

  it("sends Gemini generateContent requests with text and inline file parts", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "gemini hello" }] } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = geminiProvider({
      provider: "gemini",
      model: "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gem-key",
      maxTokens: 321,
    });
    await expect(adapter.complete([{ role: "assistant", content: "context" }, { role: "user", content: "hi" }]))
      .resolves.toBe("gemini hello");
    await expect(adapter.completeBlocks!([
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "abc" } },
      { type: "text", text: "Extract this." },
    ], "Use JSON.")).resolves.toBe("gemini hello");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-goog-api-key": "gem-key" }),
        body: JSON.stringify({
          contents: [
            { role: "model", parts: [{ text: "context" }] },
            { role: "user", parts: [{ text: "hi" }] },
          ],
          generationConfig: { maxOutputTokens: 321 },
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      expect.objectContaining({
        body: JSON.stringify({
          system_instruction: { parts: [{ text: "Use JSON." }] },
          contents: [{
            role: "user",
            parts: [
              { inline_data: { mime_type: "application/pdf", data: "abc" } },
              { text: "Extract this." },
            ],
          }],
          generationConfig: { maxOutputTokens: 321 },
        }),
      }),
    );
  });

  it("opts Gemini chat calls into Google Search grounding", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "grounded" }] } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = geminiProvider({
      provider: "gemini",
      model: "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gem-key",
      maxTokens: 321,
    });
    await expect(adapter.complete([{ role: "user", content: "what happened today?" }], { webSearch: true }))
      .resolves.toBe("grounded");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      expect.objectContaining({
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "what happened today?" }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 321 },
        }),
      }),
    );
  });

  it("sends Ollama native chat with stream disabled and num_predict", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: "local hello" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = ollamaProvider({
      provider: "ollama",
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
      maxTokens: 456,
    });
    await expect(adapter.complete([{ role: "user", content: "hi" }])).resolves.toBe("local hello");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "llama3.2",
          messages: [{ role: "user", content: "hi" }],
          stream: false,
          think: false,
          options: { num_predict: 456 },
        }),
      }),
    );
  });
});

describe("provider-neutral AI wrapper", () => {
  it("strips local reasoning blocks before returning text", async () => {
    const adapter: LLMAdapter = {
      provider: "ollama",
      model: "fake-reasoning-model",
      capabilities: { text: true, json: true, vision: false, pdf: false },
      complete: async () => "<think>I should not be shown.</think>\n\nHi there. How can I help?",
    };

    await expect(createAI(adapter).text("Say hello")).resolves.toBe("Hi there. How can I help?");
  });

  it("strips reasoning blocks before JSON parsing", async () => {
    const adapter: LLMAdapter = {
      provider: "ollama",
      model: "fake-reasoning-model",
      capabilities: { text: true, json: true, vision: false, pdf: false },
      complete: async () => "<thinking>Build the object first.</thinking>\n{\"ok\":true}",
    };

    await expect(createAI(adapter).json("Return JSON")).resolves.toEqual({ ok: true });
  });

  it("creates a one-off AI client from an unsaved provider config", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output_text: "OK" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const ai = createAIFromConfig({
      provider: "openai",
      model: "gpt-5.2",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "setup-key",
      maxTokens: 32,
    });

    await expect(ai.text("Reply OK")).resolves.toBe("OK");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer setup-key" }),
      }),
    );
  });

  it("uses the JSON repair round-trip and preserves the system preamble shaping", async () => {
    const calls: Array<{ role: string; content: string }[]> = [];
    const adapter: LLMAdapter = {
      provider: "ollama",
      model: "fake",
      capabilities: { text: true, json: true, vision: false, pdf: false },
      complete: async (messages) => {
        calls.push(messages);
        return calls.length === 1 ? "not json" : '{"ok":true}';
      },
    };

    await expect(createAI(adapter).json("PROMPT", { system: "SYSTEM" })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toEqual({ role: "user", content: "SYSTEM" });
    expect(calls[0][1].role).toBe("assistant");
    expect(calls[1]).toContainEqual({ role: "user", content: "Return ONLY valid JSON matching the schema. Be concise so it fits. No prose, no code fences." });
  });
});

describe("LLM error mapping", () => {
  it("returns safe client responses for LLM errors", async () => {
    const res = toErrorResponse(new LLMError(422, "llm_unsupported", "PDF extraction requires a configured multimodal LLM provider.", "ollama", { apiKey: "secret" }));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      error: "PDF extraction requires a configured multimodal LLM provider.",
      code: "llm_unsupported",
    });
  });
});
