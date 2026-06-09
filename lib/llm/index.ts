import { LLMError } from "@/lib/llm/errors";
import { extractJSON, repairJSON } from "@/lib/llm/json";
import {
  PROVIDER_CAPABILITIES,
  publicLLMStatus,
  resolveAnthropicFileFallback,
  resolveFileLLMConfig,
  resolveMainLLMConfig,
  resolveTaskLLMConfig,
} from "@/lib/llm/config";
import { anthropicProvider } from "@/lib/llm/providers/anthropic";
import { geminiProvider } from "@/lib/llm/providers/gemini";
import { openAICompatibleProvider } from "@/lib/llm/providers/openaiCompatible";
import { ollamaProvider } from "@/lib/llm/providers/ollama";
import type { AI, AIMessage, AIOptions, LLMAdapter, LLMConfig, LLMTask, MultimodalContentBlock } from "@/lib/llm/types";

export type {
  AI,
  AIMessage,
  AIOptions,
  AnthropicContentBlock,
  LLMAdapter,
  LLMConfig,
  LLMProvider,
  LLMTask,
  MultimodalContentBlock,
} from "@/lib/llm/types";
export { LLMError } from "@/lib/llm/errors";
export { extractJSON, repairJSON } from "@/lib/llm/json";
export { LLM_TASK_LABELS, LLM_TASKS, publicLLMStatus, resolveMainLLMConfig, resolveTaskLLMConfig, resolveFileLLMConfig } from "@/lib/llm/config";

function createAdapter(config: LLMConfig): LLMAdapter {
  if (config.provider === "anthropic") return anthropicProvider(config);
  if (config.provider === "gemini") return geminiProvider(config);
  if (config.provider === "openai" || config.provider === "openai-compatible" || config.provider === "xai") {
    return openAICompatibleProvider(config);
  }
  return ollamaProvider(config);
}

function withSystemPreamble(messages: AIMessage[], system?: string): AIMessage[] {
  return system
    ? [
        { role: "user", content: system },
        { role: "assistant", content: "Understood. I will follow these instructions exactly and reply only in the specified format." },
        ...messages,
      ]
    : messages;
}

export function createAI(adapter: LLMAdapter): AI {
  async function complete(messages: AIMessage[], system?: string): Promise<string> {
    return adapter.complete(withSystemPreamble(messages, system));
  }

  async function json<T = unknown>(prompt: string, { system }: AIOptions = {}): Promise<T> {
    const messages: AIMessage[] = [{ role: "user", content: prompt }];
    let out = await complete(messages, system);
    let parsed = extractJSON<T>(out) || repairJSON<T>(out);
    if (parsed) return parsed;

    messages.push({ role: "assistant", content: out });
    messages.push({ role: "user", content: "Return ONLY valid JSON matching the schema. Be concise so it fits. No prose, no code fences." });
    out = await complete(messages, system);
    parsed = extractJSON<T>(out) || repairJSON<T>(out);
    if (parsed) return parsed;
    throw new LLMError(502, "llm_parse", "Could not parse JSON from model output.", adapter.provider);
  }

  async function text(prompt: string, { system }: AIOptions = {}): Promise<string> {
    return complete([{ role: "user", content: prompt }], system);
  }

  return { complete, json, text, extractJSON, repairJSON };
}

let mainAdapter: LLMAdapter | null = null;
let mainAI: AI | null = null;
let mainConfigKey: string | null = null;
const taskAIs = new Map<LLMTask, { key: string; ai: AI }>();

function configKey(config: LLMConfig): string {
  return JSON.stringify({
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl ?? "",
    maxTokens: config.maxTokens,
    apiKey: config.apiKey ? `set:${config.apiKey.slice(-6)}` : "",
  });
}

function getMainAdapter(): LLMAdapter {
  const config = resolveMainLLMConfig();
  const key = configKey(config);
  if (!mainAdapter || mainConfigKey !== key) {
    mainAdapter = createAdapter(config);
    mainAI = null;
    mainConfigKey = key;
  }
  return mainAdapter;
}

export function getAI(): AI {
  if (!mainAI) mainAI = createAI(getMainAdapter());
  return mainAI;
}

export function getAIForTask(task: LLMTask): AI {
  const config = resolveTaskLLMConfig(task);
  const key = configKey(config);
  const cached = taskAIs.get(task);
  if (cached?.key === key) return cached.ai;
  const next = createAI(createAdapter(config));
  taskAIs.set(task, { key, ai: next });
  return next;
}

export function getFileAI(required: "vision" | "pdf"): LLMAdapter {
  const fileConfig = resolveFileLLMConfig();
  const candidates: LLMConfig[] = [];
  if (fileConfig) candidates.push(fileConfig);
  const fallback = resolveAnthropicFileFallback();
  if (fallback && !candidates.some((c) => c.provider === fallback.provider && c.model === fallback.model)) {
    candidates.push(fallback);
  }

  for (const config of candidates) {
    const caps = PROVIDER_CAPABILITIES[config.provider];
    if (caps[required]) {
      const adapter = createAdapter(config);
      if (adapter.completeBlocks) return adapter;
    }
  }

  throw new LLMError(
    422,
    "llm_unsupported",
    `${required === "pdf" ? "PDF" : "Image"} extraction requires a configured multimodal LLM provider.`,
  );
}

export async function completeBlocks(content: MultimodalContentBlock[], system?: string): Promise<string> {
  return getFileAI("vision").completeBlocks!(content, system);
}

export function resetLLMForTests() {
  mainAdapter = null;
  mainAI = null;
  mainConfigKey = null;
  taskAIs.clear();
}

export const ai: AI = {
  complete(messages, system) {
    return getAI().complete(messages, system);
  },
  json(prompt, opts) {
    return getAI().json(prompt, opts);
  },
  text(prompt, opts) {
    return getAI().text(prompt, opts);
  },
  extractJSON,
  repairJSON,
};
