export type LLMProvider = "anthropic" | "openai" | "openai-compatible" | "xai" | "ollama" | "gemini";

export type LLMTask =
  | "gather"
  | "weave"
  | "draft"
  | "review"
  | "revision"
  | "outputs"
  | "utility"
  | "mediaPrompt"
  | "file";

export interface LLMCapabilities {
  text: boolean;
  json: boolean;
  vision: boolean;
  pdf: boolean;
}

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIOptions {
  system?: string;
}

export interface AI {
  complete(messages: AIMessage[], system?: string): Promise<string>;
  json<T = unknown>(prompt: string, opts?: AIOptions): Promise<T>;
  text(prompt: string, opts?: AIOptions): Promise<string>;
  extractJSON<T = unknown>(text: string): T | null;
  repairJSON<T = unknown>(text: string): T | null;
}

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  apiKey?: string;
  baseUrl?: string;
}

export type MultimodalContentBlock =
  | { type: "text"; text: string }
  | {
      type: "document" | "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

/** @deprecated Use MultimodalContentBlock. */
export type AnthropicContentBlock = MultimodalContentBlock;

export interface LLMAdapter {
  provider: LLMProvider;
  model: string;
  capabilities: LLMCapabilities;
  complete(messages: AIMessage[]): Promise<string>;
  completeBlocks?(content: MultimodalContentBlock[], system?: string): Promise<string>;
}
