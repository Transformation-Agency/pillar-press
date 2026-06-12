import type { LLMProvider } from "@/lib/llm/types";

export interface LLMProfileForContext {
  provider?: LLMProvider | string | null;
  model?: string | null;
}

function cleanModel(model: string | null | undefined): string {
  return String(model || "")
    .trim()
    .replace(/^models\//, "")
    .toLowerCase();
}

function contextFromExplicitName(model: string): number | null {
  const match = model.match(/(?:^|[^0-9])(\d{1,4})k(?:[^a-z0-9]|$)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

export function estimatedModelContextWindow(profile: LLMProfileForContext): number | null {
  const provider = String(profile.provider || "");
  const model = cleanModel(profile.model);
  if (!model) return null;

  const explicit = contextFromExplicitName(model);
  if (explicit) return explicit;

  if (provider === "openai") {
    if (/^(gpt-5|gpt-4\.1|gpt-4o|o1|o3|o4)(?:[.-]|$)/.test(model)) return 128000;
    if (/^gpt-4-turbo(?:-|$)/.test(model)) return 128000;
    if (/^gpt-4-32k(?:-|$)/.test(model)) return 32000;
    if (/^gpt-4(?:-|$)/.test(model)) return 8192;
    if (/^gpt-3\.5-turbo(?:-|$)/.test(model)) return model.includes("16k") ? 16000 : 4096;
    return null;
  }

  if (provider === "anthropic") {
    if (/^claude-(3|3\.5|3\.7|4|haiku|sonnet|opus)/.test(model)) return 200000;
    return null;
  }

  if (provider === "gemini") {
    if (/gemini-(1\.5|2\.0|2\.5|3|3\.1|3\.5)/.test(model)) return 1000000;
    if (/gemini-1\.0/.test(model)) return 32000;
    return null;
  }

  if (provider === "xai") {
    if (/grok-(4|4\.)/.test(model)) return 256000;
    if (/grok-(3|3\.)/.test(model)) return 131000;
    if (/grok-(2|2\.)/.test(model)) return 131000;
    return null;
  }

  if (provider === "ollama" || provider === "openai-compatible") {
    if (model.includes("70b") || model.includes("128k")) return 128000;
    if (model.includes("32k")) return 32000;
    return null;
  }

  return null;
}

export function fallbackContextWindow(profile: LLMProfileForContext | null | undefined): number {
  return estimatedModelContextWindow(profile || {}) || 8192;
}
