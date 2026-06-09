import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAI, LLMError, type LLMAdapter } from "@/lib/llm";
import { resolveMainLLMConfig, resolveTaskLLMConfig, publicLLMStatus } from "@/lib/llm/config";
import { geminiProvider } from "@/lib/llm/providers/gemini";
import { openAICompatibleProvider } from "@/lib/llm/providers/openaiCompatible";
import { ollamaProvider } from "@/lib/llm/providers/ollama";
import { toErrorResponse } from "@/lib/errors";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LLM config", () => {
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
    const dir = mkdtempSync(join(tmpdir(), "kings-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({ model: "mistral-small:latest" }));
    try {
      const cfg = resolveMainLLMConfig({
        KINGS_PRESS_LOCAL_FIRST: "true",
        KINGS_PRESS_LLM_SETTINGS_PATH: settingsPath,
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

  it("uses saved desktop provider settings for local-first OpenAI-compatible endpoints", () => {
    const dir = mkdtempSync(join(tmpdir(), "kings-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      provider: "openai-compatible",
      model: "ai/smollm2",
      baseUrl: "http://localhost:12434/engines/v1",
      apiKey: "local-key",
    }));
    try {
      const cfg = resolveMainLLMConfig({
        KINGS_PRESS_LOCAL_FIRST: "true",
        KINGS_PRESS_LLM_SETTINGS_PATH: settingsPath,
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
    const dir = mkdtempSync(join(tmpdir(), "kings-press-llm-"));
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
        KINGS_PRESS_LOCAL_FIRST: "true",
        KINGS_PRESS_LLM_SETTINGS_PATH: settingsPath,
      })).toMatchObject({
        provider: "ollama",
        model: "llama3.2",
      });
      expect(resolveTaskLLMConfig("draft", {
        KINGS_PRESS_LOCAL_FIRST: "true",
        KINGS_PRESS_LLM_SETTINGS_PATH: settingsPath,
      })).toMatchObject({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-openai",
        baseUrl: "https://api.openai.com/v1",
      });
      expect(resolveTaskLLMConfig("review", {
        KINGS_PRESS_LOCAL_FIRST: "true",
        KINGS_PRESS_LLM_SETTINGS_PATH: settingsPath,
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

  it("lets task env overrides win over desktop defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "kings-press-llm-"));
    const settingsPath = join(dir, "desktop-settings.json");
    writeFileSync(settingsPath, JSON.stringify({
      profiles: [{ id: "local", provider: "ollama", model: "llama3.2" }],
      defaultProfileId: "local",
      taskDefaults: { review: "local" },
    }));
    try {
      expect(resolveTaskLLMConfig("review", {
        KINGS_PRESS_LOCAL_FIRST: "true",
        KINGS_PRESS_LLM_SETTINGS_PATH: settingsPath,
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
    const dir = mkdtempSync(join(tmpdir(), "kings-press-llm-"));
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
        KINGS_PRESS_LOCAL_FIRST: "true",
        KINGS_PRESS_LLM_SETTINGS_PATH: settingsPath,
      });
      expect(status).toMatchObject({
        provider: "ollama",
        model: "llama3.2",
        defaultProfileId: "local",
      });
      expect(status.profiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "anthropic-review", hasApiKey: true }),
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
      KINGS_PRESS_LOCAL_FIRST: "true",
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

  it("sends OpenAI and xAI through the chat completions transport", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "cloud hello" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const openai = openAICompatibleProvider({
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "openai-key",
      maxTokens: 100,
    });
    await expect(openai.complete([{ role: "user", content: "hi" }])).resolves.toBe("cloud hello");

    const xai = openAICompatibleProvider({
      provider: "xai",
      model: "grok-4.3",
      baseUrl: "https://api.x.ai/v1",
      apiKey: "xai-key",
      maxTokens: 200,
    });
    await expect(xai.complete([{ role: "user", content: "hi" }])).resolves.toBe("cloud hello");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer openai-key" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.x.ai/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer xai-key" }),
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
          options: { num_predict: 456 },
        }),
      }),
    );
  });
});

describe("provider-neutral AI wrapper", () => {
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
