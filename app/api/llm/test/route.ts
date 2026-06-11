import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/errors";
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_XAI_BASE_URL,
  DEFAULT_MAX_TOKENS,
  resolveInteractiveLLMConfig,
} from "@/lib/llm/config";
import { createAIFromConfig, LLMError } from "@/lib/llm";
import type { LLMProvider } from "@/lib/llm";

const Body = z.object({
  provider: z.enum(["anthropic", "openai", "openai-compatible", "xai", "ollama", "gemini"]),
  model: z.string().trim().min(1).max(200),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});

function defaultBaseUrl(provider: LLMProvider): string | undefined {
  if (provider === "ollama") return DEFAULT_OLLAMA_BASE_URL;
  if (provider === "openai") return DEFAULT_OPENAI_BASE_URL;
  if (provider === "xai") return DEFAULT_XAI_BASE_URL;
  if (provider === "gemini") return DEFAULT_GEMINI_BASE_URL;
  return undefined;
}

function normalizeConfig(body: z.infer<typeof Body>) {
  const provider = body.provider;
  const baseUrl = body.baseUrl?.trim().replace(/\/+$/, "") || defaultBaseUrl(provider);

  if (provider === "openai-compatible" && !baseUrl) {
    throw new LLMError(422, "validation", "Add a base URL before testing this provider.", provider);
  }

  return resolveInteractiveLLMConfig(provider, {
    apiKey: body.apiKey,
    baseUrl,
    model: body.model,
    maxTokens: String(Math.min(DEFAULT_MAX_TOKENS, 32)),
  });
}

export async function POST(req: Request) {
  try {
    await requireUser();
    const body = Body.parse(await req.json());
    const ai = createAIFromConfig(normalizeConfig(body));
    const text = await ai.text("Reply with exactly OK. No punctuation, no extra words.");
    return NextResponse.json({
      ok: true,
      provider: body.provider,
      model: body.model,
      sample: text.trim().slice(0, 80),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
