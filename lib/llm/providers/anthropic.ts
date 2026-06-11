import Anthropic from "@anthropic-ai/sdk";
import { LLMError, providerRequestError } from "@/lib/llm/errors";
import { PROVIDER_CAPABILITIES } from "@/lib/llm/config";
import type { AnthropicContentBlock, AIMessage, AIOptions, LLMAdapter, LLMConfig } from "@/lib/llm/types";

export function anthropicProvider(config: LLMConfig): LLMAdapter {
  if (!config.apiKey) {
    throw new LLMError(500, "llm_config", "Missing Anthropic API key.", "anthropic");
  }
  const client = new Anthropic({ apiKey: config.apiKey });

  async function finalText(stream: ReturnType<Anthropic["messages"]["stream"]>): Promise<string> {
    const resp = await stream.finalMessage();
    const sources: Array<{ title?: string; url: string }> = [];
    const text = resp.content.map((block: Anthropic.ContentBlock) => {
      if (block.type !== "text") return "";
      const citations = Array.isArray((block as any).citations) ? (block as any).citations : [];
      citations.forEach((citation: any) => {
        const url = String(citation?.url || "").trim();
        if (url) sources.push({ title: String(citation?.title || "").trim(), url });
      });
      return block.text;
    }).join("");
    if (!sources.length) return text;
    const seen = new Set<string>();
    const lines = sources
      .filter((source) => {
        if (seen.has(source.url)) return false;
        seen.add(source.url);
        return true;
      })
      .slice(0, 8)
      .map((source) => `- [${source.title || source.url}](${source.url})`);
    return `${text.trim()}\n\nSources:\n${lines.join("\n")}`;
  }

  return {
    provider: "anthropic",
    model: config.model,
    capabilities: PROVIDER_CAPABILITIES.anthropic,
    async complete(messages: AIMessage[], opts?: AIOptions) {
      try {
        return await finalText(client.messages.stream({
          model: config.model,
          max_tokens: config.maxTokens,
          ...(opts?.webSearch ? {
            tools: [{
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 5,
            }] as Anthropic.ToolUnion[],
          } : {}),
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
