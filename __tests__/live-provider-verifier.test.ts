import { describe, expect, it } from "vitest";
import { mergeSavedProviderSettings } from "@/scripts/verify-live-provider-flows";

describe("live provider verifier saved desktop settings", () => {
  it("merges saved OpenAI/xAI profile keys as media settings without copying LLM profiles", () => {
    const base: Record<string, unknown> = {
      provider: "ollama",
      model: "gemma4:26b-mlx",
      profiles: [{ id: "ollama-local", provider: "ollama", model: "gemma4:26b-mlx" }],
      mediaProviders: {
        hedra: { apiKey: "kpenc:v1:hedra" },
      },
    };
    const saved = {
      profiles: [
        {
          id: "xai-live",
          label: "xAI / Grok",
          provider: "xai",
          model: "grok-4.3",
          apiKey: "kpenc:v1:xai",
          baseUrl: "https://api.x.ai/v1",
        },
        {
          id: "openai-live",
          provider: "openai",
          model: "gpt-4o-mini",
          apiKey: "kpenc:v1:openai",
        },
        {
          id: "anthropic-live",
          provider: "anthropic",
          model: "claude-haiku-4-5",
          apiKey: "kpenc:v1:anthropic",
        },
      ],
      mediaProviders: {
        elevenlabs: { apiKey: "kpenc:v1:eleven" },
      },
    };

    mergeSavedProviderSettings(base, saved);

    expect(base.profiles).toEqual([{ id: "ollama-local", provider: "ollama", model: "gemma4:26b-mlx" }]);
    expect(base.mediaProviders).toMatchObject({
      hedra: { apiKey: "kpenc:v1:hedra" },
      elevenlabs: { apiKey: "kpenc:v1:eleven" },
      xai: { apiKey: "kpenc:v1:xai", baseUrl: "https://api.x.ai/v1" },
      openai: { apiKey: "kpenc:v1:openai", baseUrl: "https://api.openai.com/v1" },
    });
    expect(JSON.stringify(base)).not.toContain("anthropic-live");
    expect(JSON.stringify(base)).not.toContain("kpenc:v1:anthropic");
  });

  it("does not overwrite explicit saved media provider credentials", () => {
    const base: Record<string, unknown> = {};
    mergeSavedProviderSettings(base, {
      profiles: [{ id: "xai-profile", provider: "xai", model: "grok-4.3", apiKey: "kpenc:v1:profile" }],
      mediaProviders: { xai: { apiKey: "kpenc:v1:media", baseUrl: "https://media.example/v1" } },
    });

    expect(base.mediaProviders).toEqual({
      xai: { apiKey: "kpenc:v1:media", baseUrl: "https://media.example/v1" },
    });
  });
});
