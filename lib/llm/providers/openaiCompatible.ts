import { LLMError } from "@/lib/llm/errors";
import { PROVIDER_CAPABILITIES } from "@/lib/llm/config";
import type { AIMessage, AIOptions, LLMAdapter, LLMConfig } from "@/lib/llm/types";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
};

type OpenAIResponsesResponse = {
  output_text?: string;
  citations?: string[];
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
      annotations?: Array<{
        type?: string;
        url?: string;
        title?: string;
      }>;
    }>;
  }>;
};

function contentToText(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part?.type === "text" ? part.text ?? "" : "")).join("");
  return "";
}

function responsesText(json: OpenAIResponsesResponse): string {
  if (json.output_text) return json.output_text;
  return (json.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || "")
    .join("");
}

function appendSources(text: string, sources: Array<{ title?: string; url: string }>): string {
  const deduped: Array<{ title?: string; url: string }> = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const url = source.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    deduped.push({ title: source.title?.trim(), url });
    if (deduped.length >= 8) break;
  }
  if (!deduped.length) return text;
  const body = deduped
    .map((source) => `- [${source.title || source.url}](${source.url})`)
    .join("\n");
  return `${text.trim()}\n\nSources:\n${body}`;
}

function responsesSources(json: OpenAIResponsesResponse): Array<{ title?: string; url: string }> {
  const annotationSources = (json.output || [])
    .flatMap((item) => item.content || [])
    .flatMap((part) => part.annotations || [])
    .map((annotation) => ({ title: annotation.title, url: annotation.url || "" }));
  const citationSources = (json.citations || []).map((url) => ({ url }));
  return [...annotationSources, ...citationSources];
}

async function upstreamErrorMessage(res: Response, provider: LLMConfig["provider"]): Promise<string> {
  const fallback = `${provider} request failed.`;
  try {
    const payload = await res.json() as { error?: { message?: string }; message?: string };
    const message = payload?.error?.message || payload?.message;
    return message ? `${fallback} ${message}` : fallback;
  } catch {
    return fallback;
  }
}

export function openAIProvider(config: LLMConfig): LLMAdapter {
  const baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${baseUrl}/responses`;

  return {
    provider: config.provider,
    model: config.model,
    capabilities: PROVIDER_CAPABILITIES[config.provider],
    async complete(messages: AIMessage[], opts?: AIOptions) {
      if (!config.apiKey) {
        throw new LLMError(500, "llm_config", "Missing OpenAI API key.", "openai");
      }
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            input: messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            max_output_tokens: config.maxTokens,
            ...(opts?.webSearch ? {
              tools: [{ type: "web_search", search_context_size: "low" }],
              tool_choice: "auto",
            } : {}),
          }),
        });
      } catch (err) {
        throw new LLMError(502, "llm", "openai request failed.", "openai", (err as Error)?.message);
      }
      if (!res.ok) {
        throw new LLMError(res.status, "llm", await upstreamErrorMessage(res, "openai"), "openai");
      }
      const json = (await res.json()) as OpenAIResponsesResponse;
      const text = appendSources(responsesText(json), responsesSources(json));
      if (!text) throw new LLMError(502, "llm", "openai returned no text.", "openai");
      return text;
    },
  };
}

export function openAICompatibleProvider(config: LLMConfig): LLMAdapter {
  if (!config.baseUrl) {
    throw new LLMError(500, "llm_config", `Missing ${config.provider} base URL.`, config.provider);
  }
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const responsesUrl = `${config.baseUrl.replace(/\/+$/, "")}/responses`;

  return {
    provider: config.provider,
    model: config.model,
    capabilities: PROVIDER_CAPABILITIES[config.provider],
    async complete(messages: AIMessage[], opts?: AIOptions) {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      let res: Response;
      try {
        if (config.provider === "xai" && opts?.webSearch) {
          res = await fetch(responsesUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: config.model,
              input: messages.map((message) => ({
                role: message.role,
                content: message.content,
              })),
              max_output_tokens: config.maxTokens,
              tools: [{ type: "web_search" }],
              tool_choice: "auto",
            }),
          });
        } else {
          res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: config.model,
              messages,
              max_tokens: config.maxTokens,
            }),
          });
        }
      } catch (err) {
        throw new LLMError(502, "llm", `${config.provider} request failed.`, config.provider, (err as Error)?.message);
      }
      if (!res.ok) {
        throw new LLMError(res.status, "llm", await upstreamErrorMessage(res, config.provider), config.provider);
      }
      const json = (await res.json()) as ChatResponse | OpenAIResponsesResponse;
      const text = config.provider === "xai" && opts?.webSearch
        ? appendSources(responsesText(json as OpenAIResponsesResponse), responsesSources(json as OpenAIResponsesResponse))
        : contentToText((json as ChatResponse).choices?.[0]?.message?.content);
      if (!text) throw new LLMError(502, "llm", `${config.provider} returned no text.`, config.provider);
      return text;
    },
  };
}
