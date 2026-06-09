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
    `${provider} request failed.`,
    provider,
    e?.message,
  );
}
