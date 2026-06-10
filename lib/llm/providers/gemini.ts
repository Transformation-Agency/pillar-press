import { LLMError } from "@/lib/llm/errors";
import { PROVIDER_CAPABILITIES } from "@/lib/llm/config";
import type { AIMessage, LLMAdapter, LLMConfig, MultimodalContentBlock } from "@/lib/llm/types";

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

function toGeminiRole(role: AIMessage["role"]): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

function textFromResponse(json: GeminiResponse): string {
  return (json.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
}

function blockToPart(block: MultimodalContentBlock): GeminiPart {
  if (block.type === "text") return { text: block.text };
  return {
    inline_data: {
      mime_type: block.source.media_type,
      data: block.source.data,
    },
  };
}

export function geminiProvider(config: LLMConfig): LLMAdapter {
  if (!config.apiKey) {
    throw new LLMError(500, "llm_config", "Missing Gemini API key.", "gemini");
  }
  if (!config.baseUrl) {
    throw new LLMError(500, "llm_config", "Missing Gemini base URL.", "gemini");
  }

  const modelPath = config.model.replace(/^models\//, "");
  const url = `${config.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(modelPath)}:generateContent`;

  async function request(body: Record<string, unknown>): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-goog-api-key": config.apiKey || "",
        },
        body: JSON.stringify({
          ...body,
          generationConfig: {
            maxOutputTokens: config.maxTokens,
          },
        }),
      });
    } catch (err) {
      throw new LLMError(502, "llm", "gemini request failed.", "gemini", (err as Error)?.message);
    }
    if (!res.ok) {
      throw new LLMError(res.status, "llm", "gemini request failed.", "gemini");
    }
    const json = (await res.json()) as GeminiResponse;
    const text = textFromResponse(json);
    if (!text) throw new LLMError(502, "llm", "gemini returned no text.", "gemini");
    return text;
  }

  return {
    provider: "gemini",
    model: config.model,
    capabilities: PROVIDER_CAPABILITIES.gemini,
    complete(messages: AIMessage[]) {
      return request({
        contents: messages.map((message) => ({
          role: toGeminiRole(message.role),
          parts: [{ text: message.content }],
        })),
      });
    },
    completeBlocks(content: MultimodalContentBlock[], system?: string) {
      return request({
        ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: "user", parts: content.map(blockToPart) }],
      });
    },
  };
}
