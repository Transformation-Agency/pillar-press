import type { LLMProvider } from "@/lib/llm/types";

export class LLMError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public provider?: LLMProvider,
    public details?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export function providerRequestError(provider: LLMProvider, err: unknown): LLMError {
  const e = err as { status?: number; message?: string };
  return new LLMError(
    e?.status ?? 502,
    "llm",
    providerMessage(provider, e?.status, e?.message),
    provider,
    safeProviderDetail(e?.message),
  );
}

function providerLabel(provider: LLMProvider): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "xai") return "xAI / Grok";
  if (provider === "openai-compatible") return "OpenAI-compatible provider";
  if (provider === "ollama") return "Ollama";
  if (provider === "gemini") return "Gemini";
  if (provider === "anthropic") return "Anthropic";
  return provider;
}

export function safeProviderDetail(value: unknown): string | undefined {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? JSON.stringify(value)
      : "";
  const clean = raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]{12,}/gi, "sk-[redacted]")
    .replace(/api[_-]?key[=:]\s*[^&\s]+/gi, "api_key=[redacted]")
    .replace(/password[=:]\s*[^&\s]+/gi, "password=[redacted]")
    .replace(/https?:\/\/[^@\s/]+@/gi, "https://[redacted]@")
    .trim();
  return clean ? clean.slice(0, 600) : undefined;
}

export function providerMessage(provider: LLMProvider, status?: number, detail?: unknown): string {
  const label = providerLabel(provider);
  const safe = safeProviderDetail(detail)?.toLowerCase() || "";
  if (status === 401 || status === 403) {
    return `${label} rejected the API key. Reconnect the provider or paste a fresh key.`;
  }
  if (status === 404 || /\bmodel\b/.test(safe) && /(not found|does not exist|not available|invalid|unsupported)/.test(safe)) {
    return `${label} could not use the selected model. List models, pick one available to this key, then test again.`;
  }
  if (status === 400 && /(max_tokens|max output|maxoutput|max completion|max_completion_tokens|too large|context)/.test(safe)) {
    return `${label} rejected the token limit for this model. King's Press will use a safer output limit for this provider.`;
  }
  if (status === 429) {
    return `${label} is rate limited right now. Try again shortly or switch providers.`;
  }
  if (status && status >= 500) {
    return `${label} is temporarily unavailable. Try again or switch providers.`;
  }
  return `${label} request failed. Check the selected provider, model, and key, then test again.`;
}

export async function providerResponseError(provider: LLMProvider, res: Response): Promise<LLMError> {
  let detail: unknown;
  try {
    const contentType = res.headers.get("content-type") || "";
    detail = contentType.includes("application/json") ? await res.json() : await res.text();
  } catch {
    detail = undefined;
  }
  return new LLMError(
    res.status,
    "llm",
    providerMessage(provider, res.status, detail),
    provider,
    safeProviderDetail(detail),
  );
}
