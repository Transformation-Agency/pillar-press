import { LLMError } from "@/lib/llm/errors";
import { PROVIDER_CAPABILITIES } from "@/lib/llm/config";
import type { AIMessage, LLMAdapter, LLMConfig } from "@/lib/llm/types";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
};

function contentToText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part?.type === "text" ? part.text ?? "" : "")).join("");
  return "";
}

export function openAICompatibleProvider(config: LLMConfig): LLMAdapter {
  if (!config.baseUrl) {
    throw new LLMError(500, "llm_config", `Missing ${config.provider} base URL.`, config.provider);
  }
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  return {
    provider: config.provider,
    model: config.model,
    capabilities: PROVIDER_CAPABILITIES[config.provider],
    async complete(messages: AIMessage[]) {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: config.model,
            messages,
            max_tokens: config.maxTokens,
          }),
        });
      } catch (err) {
        throw new LLMError(502, "llm", `${config.provider} request failed.`, config.provider, (err as Error)?.message);
      }
      if (!res.ok) {
        throw new LLMError(res.status, "llm", `${config.provider} request failed.`, config.provider);
      }
      const json = (await res.json()) as ChatResponse;
      const text = contentToText(json.choices?.[0]?.message?.content);
      if (!text) throw new LLMError(502, "llm", `${config.provider} returned no text.`, config.provider);
      return text;
    },
  };
}
