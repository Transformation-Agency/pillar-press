import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/errors";
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_XAI_BASE_URL,
  resolveProviderConnection,
} from "@/lib/llm/config";
import { LLMError } from "@/lib/llm";

const Body = z.object({
  provider: z.enum(["anthropic", "openai", "openai-compatible", "xai", "ollama", "gemini"]).default("openai-compatible"),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});

type ModelsResponse = {
  data?: Array<{ id?: string }>;
  models?: Array<{ name?: string; id?: string } | string>;
};

type GeminiModelsResponse = {
  models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
};

function normalizeModels(payload: ModelsResponse): string[] {
  const fromData = Array.isArray(payload.data) ? payload.data.map((m) => m.id) : [];
  const fromModels = Array.isArray(payload.models)
    ? payload.models.map((m) => (typeof m === "string" ? m : m.name || m.id))
    : [];
  return [...fromData, ...fromModels]
    .filter((m): m is string => Boolean(m && m.trim()))
    .map((m) => m.replace(/^models\//, ""))
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .sort((a, b) => a.localeCompare(b));
}

function defaultBaseUrl(provider: z.infer<typeof Body>["provider"]): string | undefined {
  if (provider === "openai") return DEFAULT_OPENAI_BASE_URL;
  if (provider === "xai") return DEFAULT_XAI_BASE_URL;
  if (provider === "gemini") return DEFAULT_GEMINI_BASE_URL;
  if (provider === "anthropic") return "https://api.anthropic.com/v1";
  if (provider === "ollama") return DEFAULT_OLLAMA_BASE_URL;
  return undefined;
}

function headersFor(provider: z.infer<typeof Body>["provider"], apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = apiKey?.trim();
  if (!key) return headers;
  if (provider === "anthropic") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
    return headers;
  }
  if (provider === "gemini") {
    headers["x-goog-api-key"] = key;
    return headers;
  }
  headers.Authorization = `Bearer ${key}`;
  return headers;
}

function modelsUrl(provider: z.infer<typeof Body>["provider"], baseUrl?: string): string {
  const root = (baseUrl?.trim() || defaultBaseUrl(provider))?.replace(/\/+$/, "");
  if (!root) throw new LLMError(422, "validation", "Add a base URL before listing models.", provider);
  if (provider === "ollama") return `${root}/api/tags`;
  return `${root}/models`;
}

function normalizeGeminiModels(payload: GeminiModelsResponse): string[] {
  return (payload.models || [])
    .filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes("generateContent"))
    .map((model) => model.name?.replace(/^models\//, ""))
    .filter((m): m is string => Boolean(m && m.trim()))
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .sort((a, b) => a.localeCompare(b));
}

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const connection = resolveProviderConnection(body.provider, {
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });
    const url = modelsUrl(body.provider, connection.baseUrl);
    const headers = headersFor(body.provider, connection.apiKey);

    const res = await fetch(url, { headers });
    if (!res.ok) {
      return NextResponse.json({ models: [], error: "Could not list models from this provider." }, { status: res.status });
    }
    const payload = await res.json();
    if (body.provider === "gemini") return NextResponse.json({ models: normalizeGeminiModels(payload as GeminiModelsResponse) });
    return NextResponse.json({ models: normalizeModels(payload as ModelsResponse) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
