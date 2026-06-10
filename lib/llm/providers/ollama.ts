import { LLMError } from "@/lib/llm/errors";
import { PROVIDER_CAPABILITIES } from "@/lib/llm/config";
import type { AIMessage, LLMAdapter, LLMConfig } from "@/lib/llm/types";

type OllamaResponse = { message?: { content?: string } };

export function ollamaProvider(config: LLMConfig): LLMAdapter {
  if (!config.baseUrl) {
    throw new LLMError(500, "llm_config", "Missing Ollama base URL.", "ollama");
  }
  const url = `${config.baseUrl.replace(/\/+$/, "")}/api/chat`;

  return {
    provider: "ollama",
    model: config.model,
    capabilities: PROVIDER_CAPABILITIES.ollama,
    async complete(messages: AIMessage[]) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            model: config.model,
            messages,
            stream: false,
            options: { num_predict: config.maxTokens },
          }),
        });
      } catch (err) {
        throw new LLMError(502, "llm", "ollama request failed.", "ollama", (err as Error)?.message);
      }
      if (!res.ok) {
        throw new LLMError(res.status, "llm", "ollama request failed.", "ollama");
      }
      const json = (await res.json()) as OllamaResponse;
      const text = json.message?.content ?? "";
      if (!text) throw new LLMError(502, "llm", "ollama returned no text.", "ollama");
      return text;
    },
  };
}
