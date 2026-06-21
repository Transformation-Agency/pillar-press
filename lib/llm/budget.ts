import type { ResolvedTaskAI } from "@/lib/llm";

export interface TextChunk {
  index: number;
  total: number;
  text: string;
  label: string;
}

export function estimateTokens(text: string | null | undefined): number {
  return Math.ceil((text || "").length / 3.5);
}

export function llmBudgetForResolvedTask(taskAI: Pick<ResolvedTaskAI, "provider" | "model"> | null | undefined): {
  contextTokens: number;
  responseReserve: number;
} {
  const model = (taskAI?.model || "").toLowerCase();
  const provider = (taskAI?.provider || "").toLowerCase();
  if (model.includes("gpt-4.1") || model.includes("gpt-4o") || model.includes("claude") || model.includes("gemini")) {
    return { contextTokens: 96_000, responseReserve: 6_000 };
  }
  if (model.includes("grok")) return { contextTokens: 96_000, responseReserve: 6_000 };
  if (provider === "ollama" || provider === "openai-compatible") {
    return { contextTokens: 24_000, responseReserve: 4_000 };
  }
  return { contextTokens: 32_000, responseReserve: 4_000 };
}

export function fitsSinglePass(input: {
  system: string;
  prompt: string;
  budget: { contextTokens: number; responseReserve: number };
  safetyMarginTokens?: number;
}): boolean {
  const margin = input.safetyMarginTokens ?? 1_000;
  return estimateTokens(input.system) + estimateTokens(input.prompt) + input.budget.responseReserve + margin <= input.budget.contextTokens;
}

function splitOversizeParagraph(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+[\s"')\]]*|[^.!?]+$/g) || [paragraph];
  const chunks: string[] = [];
  let cur = "";
  for (const sentence of sentences) {
    if (cur && cur.length + sentence.length > maxChars) {
      chunks.push(cur.trim());
      cur = "";
    }
    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars) chunks.push(sentence.slice(i, i + maxChars).trim());
    } else {
      cur += sentence;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export function buildTextChunks(
  text: string,
  opts: { maxTokens: number; overlapTokens?: number; preferHeadings?: boolean },
): TextChunk[] {
  const maxChars = Math.max(1_000, Math.floor(opts.maxTokens * 3.5));
  const parts = (text || "").split(/\n{2,}/);
  const raw: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) raw.push(cur.trim());
    cur = "";
  };

  for (const part of parts) {
    const next = cur ? `${cur}\n\n${part}` : part;
    const headingBreak = opts.preferHeadings && /^#{1,6}\s+\S/m.test(part) && cur;
    if ((next.length > maxChars || headingBreak) && cur) flush();
    if (part.length > maxChars) {
      flush();
      raw.push(...splitOversizeParagraph(part, maxChars));
    } else {
      cur = cur ? `${cur}\n\n${part}` : part;
    }
  }
  flush();

  const overlapChars = Math.max(0, Math.floor((opts.overlapTokens ?? 0) * 3.5));
  const total = raw.length || 1;
  return (raw.length ? raw : [text || ""]).map((chunk, i) => {
    const prefix = overlapChars > 0 && i > 0 ? raw[i - 1].slice(-overlapChars).trim() : "";
    const body = prefix ? `${prefix}\n\n${chunk}` : chunk;
    return { index: i + 1, total, text: body, label: `chunk ${i + 1}/${total}` };
  });
}
