import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/errors";
import { normalizeHostedProviderBaseUrl } from "@/lib/hostedProviderUrls";
import { isLocalFirstMode } from "@/lib/local/mode";
import { getHostedProviderProfile } from "@/lib/providerSettings";
import { requireByokProviderAccess } from "@/lib/billing/entitlements";
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_XAI_BASE_URL,
} from "@/lib/llm/config";
import { LLMError } from "@/lib/llm";
import { providerMessage } from "@/lib/llm/errors";

const Body = z.object({
  provider: z.enum(["anthropic", "openai", "openai-compatible", "xai", "ollama", "gemini"]).default("openai-compatible"),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  profileId: z.string().trim().optional(),
});

type ModelsResponse = {
  data?: Array<{ id?: string }>;
  models?: Array<{
    name?: string;
    model?: string;
    id?: string;
    capabilities?: string[];
    details?: { family?: string; families?: string[] };
  } | string>;
};

type GeminiModelsResponse = {
  models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
};

function modelId(model: NonNullable<ModelsResponse["models"]>[number]): string | undefined {
  return typeof model === "string" ? model : model.model || model.name || model.id;
}

function isGemma4(model: string): boolean {
  return /^gemma4(?:$|[:\-.])/i.test(model);
}

function modelPreference(model: string): number {
  if (isGemma4(model)) return 0;
  if (/^gemma(?:$|[:\-.])/i.test(model)) return 1;
  return 2;
}

function sortModels(models: string[]): string[] {
  return models.slice().sort((a, b) => modelPreference(a) - modelPreference(b) || a.localeCompare(b));
}

function openAIModelPreference(model: string): number {
  const id = model.toLowerCase();
  if (/^ft:(gpt-5|o5|gpt-4\.5|gpt-4\.1|gpt-4o|gpt-4|o[1345])/.test(id)) return 20;
  if (/^(gpt-5|o5)(?:[-.]|$)/.test(id)) return 0;
  if (/^gpt-4\.5(?:-|$)/.test(id)) return 1;
  if (/^gpt-4\.1(?:-|$)/.test(id)) return 1;
  if (/^gpt-4o(?:-|$)/.test(id)) return 2;
  if (/^gpt-4(?:[-.]|$)/.test(id)) return 3;
  if (/^o[1345](?:-|$)/.test(id)) return 4;
  if (/^chatgpt(?:-|$)/.test(id)) return 5;
  if (/^gpt-3\.5(?:-|$)/.test(id)) return 8;
  if (/^ft:/.test(id)) return 9;
  return 10;
}

function sortOpenAIModels(models: string[]): string[] {
  return models.slice().sort((a, b) => {
    const priority = openAIModelPreference(a) - openAIModelPreference(b);
    if (priority !== 0) return priority;
    const smallerVariant = Number(/mini|nano|small|lite/.test(a.toLowerCase())) - Number(/mini|nano|small|lite/.test(b.toLowerCase()));
    if (smallerVariant !== 0) return smallerVariant;
    return a.localeCompare(b);
  });
}

function isOpenAIChatModel(model: string): boolean {
  const id = model.toLowerCase();
  if (!/^(gpt-|chatgpt-|o[1345](?:-|$)|ft:(?:gpt-|o[1345](?:-|$)))/.test(id)) return false;
  return !/(embedding|embed|moderation|realtime|audio|tts|transcribe|whisper|image|dall-e|instruct|babbage|davinci|curie|ada)/.test(id);
}

function normalizeOpenAIModels(payload: ModelsResponse): { models: string[]; total: number; warning?: string } {
  const allModels = normalizeModels(payload);
  const models = sortOpenAIModels(allModels.filter(isOpenAIChatModel));
  if (models.length) return { models, total: allModels.length };
  if (!allModels.length) {
    return {
      models,
      total: 0,
      warning: "OpenAI responded, but did not list any models for this key. Check the key permissions, project, and provider endpoint.",
    };
  }
  return {
    models,
    total: allModels.length,
    warning: `OpenAI listed ${allModels.length} model${allModels.length === 1 ? "" : "s"}, but none matched the ChatGPT chat-model filter. Check that this key has access to current chat models, or type a model name and test it.`,
  };
}

function hasEmbeddingSignal(value: string | undefined): boolean {
  return /\b(embed|embedding|embeddings|nomic-embed|all-minilm)\b/i.test(value || "");
}

function isEmbeddingOnlyModel(model: {
  id?: string;
  capabilities?: string[];
  details?: { family?: string; families?: string[] };
}): boolean {
  const capabilities = Array.isArray(model.capabilities) ? model.capabilities.map((cap) => cap.toLowerCase()) : [];
  if (capabilities.length) {
    const canComplete = capabilities.some((cap) => ["completion", "chat", "generate"].includes(cap));
    const canEmbed = capabilities.some((cap) => ["embedding", "embed"].includes(cap));
    return canEmbed && !canComplete;
  }

  const families = [
    model.details?.family,
    ...(Array.isArray(model.details?.families) ? model.details?.families || [] : []),
  ];
  return [model.id, ...families].some(hasEmbeddingSignal);
}

function normalizeModels(payload: ModelsResponse, options?: { preferGemma?: boolean; filterEmbeddings?: boolean }): string[] {
  const fromData = Array.isArray(payload.data) ? payload.data.map((m) => m.id) : [];
  const fromModels = Array.isArray(payload.models)
    ? payload.models
        .filter((m) => {
          if (typeof m === "string") return !(options?.filterEmbeddings && isEmbeddingOnlyModel({ id: m }));
          return !(options?.filterEmbeddings && isEmbeddingOnlyModel({ ...m, id: modelId(m) }));
        })
        .map(modelId)
    : [];
  const models = [...fromData, ...fromModels]
    .filter((m): m is string => Boolean(m && m.trim()))
    .map((m) => m.replace(/^models\//, ""))
    .filter((m) => !(options?.filterEmbeddings && isEmbeddingOnlyModel({ id: m })))
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .sort((a, b) => a.localeCompare(b));
  return options?.preferGemma ? sortModels(models) : models;
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
  const rawRoot = baseUrl?.trim() || defaultBaseUrl(provider);
  const root = isLocalFirstMode()
    ? rawRoot?.replace(/\/+$/, "")
    : normalizeHostedProviderBaseUrl(rawRoot);
  if (!root) throw new LLMError(422, "validation", "Add a base URL before listing models.", provider);
  if (provider === "ollama") return `${root}/api/tags`;
  return `${root}/models`;
}

function modelsRoot(provider: z.infer<typeof Body>["provider"], baseUrl?: string): string {
  const rawRoot = baseUrl?.trim() || defaultBaseUrl(provider);
  const root = isLocalFirstMode()
    ? rawRoot?.replace(/\/+$/, "")
    : normalizeHostedProviderBaseUrl(rawRoot);
  if (!root) throw new LLMError(422, "validation", "Add a base URL before listing models.", provider);
  return root;
}

function normalizeGeminiModels(payload: GeminiModelsResponse): string[] {
  return (payload.models || [])
    .filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes("generateContent"))
    .map((model) => model.name?.replace(/^models\//, ""))
    .filter((m): m is string => Boolean(m && m.trim()))
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .sort((a, b) => a.localeCompare(b));
}

async function completionCapableOllamaModels(payload: ModelsResponse, root: string, headers: Record<string, string>): Promise<string[]> {
  const tags = Array.isArray(payload.models) ? payload.models : [];
  const names = normalizeModels(payload, { preferGemma: true, filterEmbeddings: true });
  if (!names.length) return [];

  const showByName = new Map<string, unknown>();
  await Promise.all(names.map(async (name) => {
    try {
      const res = await fetch(`${root}/api/show`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
      });
      if (res.ok) showByName.set(name, await res.json());
    } catch (_err) {
      // /api/tags is authoritative for installed models; keep non-embedding names if show is unavailable.
    }
  }));

  return sortModels(names.filter((name) => {
    const tag = tags.find((entry) => modelId(entry) === name);
    const show = showByName.get(name);
    const metadata = {
      id: name,
      capabilities: Array.isArray((show as { capabilities?: unknown })?.capabilities)
        ? (show as { capabilities: string[] }).capabilities
        : typeof tag === "string" ? undefined : tag?.capabilities,
      details: (show as { details?: { family?: string; families?: string[] } })?.details || (typeof tag === "string" ? undefined : tag?.details),
    };
    return !isEmbeddingOnlyModel(metadata);
  }));
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = Body.parse(await req.json());
    if (!isLocalFirstMode()) {
      if (!user.workspaceId) {
        return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
      }
      await requireByokProviderAccess({ ...user, workspaceId: user.workspaceId });
    }
    const saved = body.profileId ? await getHostedProviderProfile(user, body.profileId) : null;
    const request = saved
      ? {
          provider: saved.provider,
          baseUrl: body.baseUrl || saved.baseUrl,
          apiKey: body.apiKey || saved.apiKey,
        }
      : body;
    const root = modelsRoot(request.provider, request.baseUrl);
    const url = request.provider === "ollama" ? `${root}/api/tags` : modelsUrl(request.provider, request.baseUrl);
    const headers = headersFor(request.provider, request.apiKey);

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const contentType = res.headers.get("content-type") || "";
      const detail = contentType.includes("application/json")
        ? await res.json().catch(() => null)
        : await res.text().catch(() => "");
      return NextResponse.json({
        models: [],
        error: providerMessage(request.provider, res.status, detail),
        code: "llm",
      }, { status: res.status });
    }
    const payload = await res.json();
    if (request.provider === "gemini") return NextResponse.json({ models: normalizeGeminiModels(payload as GeminiModelsResponse) });
    if (request.provider === "ollama") {
      return NextResponse.json({ models: await completionCapableOllamaModels(payload as ModelsResponse, root, headers) });
    }
    if (request.provider === "openai") {
      const result = normalizeOpenAIModels(payload as ModelsResponse);
      return NextResponse.json(result.warning
        ? { models: result.models, totalModels: result.total, warning: result.warning }
        : { models: result.models, totalModels: result.total });
    }
    return NextResponse.json({ models: normalizeModels(payload as ModelsResponse) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
