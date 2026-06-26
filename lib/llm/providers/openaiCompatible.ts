import { LLMError, providerRequestError, providerResponseError } from "@/lib/llm/errors";
import { PROVIDER_CAPABILITIES } from "@/lib/llm/config";
import type { AIMessage, LLMAdapter, LLMConfig } from "@/lib/llm/types";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
};

type ResponsesResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function contentToText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part?.type === "text" ? part.text ?? "" : "")).join("");
  return "";
}

function maxTokensForRequest(config: LLMConfig): number {
  if (config.provider === "openai") return Math.min(config.maxTokens, 16000);
  if (config.provider === "xai") return Math.min(config.maxTokens, 8192);
  return config.maxTokens;
}

export function openAICompatibleProvider(config: LLMConfig): LLMAdapter {
  if (!config.baseUrl) {
    throw new LLMError(500, "llm_config", `Missing ${config.provider} base URL.`, config.provider);
  }
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;

  return {
    provider: config.provider,
    model: config.model,
    capabilities: PROVIDER_CAPABILITIES[config.provider],
    async complete(messages: AIMessage[], opts) {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      if (config.provider === "xai" && opts?.webSearch) {
        let res: Response;
        try {
          res = await fetch(`${baseUrl}/responses`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: config.model,
              input: messages,
              max_output_tokens: maxTokensForRequest(config),
              tools: [{ type: "web_search" }],
              tool_choice: "auto",
            }),
          });
        } catch (err) {
          throw providerRequestError(config.provider, err);
        }
        if (!res.ok) {
          throw await providerResponseError(config.provider, res);
        }
        const json = (await res.json()) as ResponsesResponse;
        const text = json.output_text || json.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("");
        if (!text) throw new LLMError(502, "llm", `${config.provider} returned no text.`, config.provider);
        return text;
      }
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: config.model,
            messages,
            max_tokens: maxTokensForRequest(config),
          }),
        });
      } catch (err) {
        throw providerRequestError(config.provider, err);
      }
      if (!res.ok) {
        throw await providerResponseError(config.provider, res);
      }
      const json = (await res.json()) as ChatResponse;
      const text = contentToText(json.choices?.[0]?.message?.content);
      if (!text) throw new LLMError(502, "llm", `${config.provider} returned no text.`, config.provider);
      return text;
    },
  };
}

export function openAIProvider(config: LLMConfig): LLMAdapter {
  const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${baseUrl}/responses`;
  return {
    provider: "openai",
    model: config.model,
    capabilities: PROVIDER_CAPABILITIES.openai,
    async complete(messages: AIMessage[], opts) {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: config.model,
            input: messages,
            max_output_tokens: config.maxTokens,
            ...(opts?.webSearch ? { tools: [{ type: "web_search", search_context_size: "low" }], tool_choice: "auto" } : {}),
          }),
        });
      } catch (err) {
        throw providerRequestError("openai", err);
      }
      if (!res.ok) {
        throw await providerResponseError("openai", res);
      }
      const json = (await res.json()) as ResponsesResponse;
      const text = json.output_text || json.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("");
      if (!text) throw new LLMError(502, "llm", "openai returned no text.", "openai");
      return text;
    },
  };
}
