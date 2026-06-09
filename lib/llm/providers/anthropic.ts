import Anthropic from "@anthropic-ai/sdk";
import { LLMError, providerRequestError } from "@/lib/llm/errors";
import { PROVIDER_CAPABILITIES } from "@/lib/llm/config";
import type { AnthropicContentBlock, AIMessage, LLMAdapter, LLMConfig } from "@/lib/llm/types";

export function anthropicProvider(config: LLMConfig): LLMAdapter {
  if (!config.apiKey) {
    throw new LLMError(500, "llm_config", "Missing Anthropic API key.", "anthropic");
  }
  const client = new Anthropic({ apiKey: config.apiKey });

  async function finalText(stream: ReturnType<Anthropic["messages"]["stream"]>): Promise<string> {
    const resp = await stream.finalMessage();
    return resp.content.map((block: Anthropic.ContentBlock) => (block.type === "text" ? block.text : "")).join("");
  }

  return {
    provider: "anthropic",
    model: config.model,
    capabilities: PROVIDER_CAPABILITIES.anthropic,
    async complete(messages: AIMessage[]) {
      try {
        return await finalText(client.messages.stream({
          model: config.model,
          max_tokens: config.maxTokens,
          messages,
        }));
      } catch (err) {
        throw providerRequestError("anthropic", err);
      }
    },
    async completeBlocks(content: AnthropicContentBlock[], system?: string) {
      try {
        return await finalText(client.messages.stream({
          model: config.model,
          max_tokens: config.maxTokens,
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: content as Anthropic.MessageParam["content"] }],
        }));
      } catch (err) {
        throw providerRequestError("anthropic", err);
      }
    },
  };
}
