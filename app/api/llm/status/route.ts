import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { publicLLMStatus } from "@/lib/llm";
import { estimatedModelContextWindow } from "@/lib/llm/context";
import { toErrorResponse } from "@/lib/errors";

type ProfileStatus = {
  provider: string;
  model: string;
  baseUrl: string | null;
  contextWindow?: number;
};

function numericContext(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function contextFromOllamaShow(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const info = root.model_info && typeof root.model_info === "object"
    ? root.model_info as Record<string, unknown>
    : {};
  const parameters = root.parameters && typeof root.parameters === "object"
    ? root.parameters as Record<string, unknown>
    : {};
  for (const source of [info, parameters, root]) {
    for (const [key, value] of Object.entries(source)) {
      if (!/(?:^|\.|_)context(?:_|\.|$)|context_length|n_ctx|num_ctx/i.test(key)) continue;
      const n = numericContext(value);
      if (n) return n;
    }
  }
  return null;
}

async function attachOllamaContextWindows(profiles: ProfileStatus[]): Promise<void> {
  await Promise.all(profiles.map(async (p) => {
    if (p.contextWindow || p.provider !== "ollama" || !p.model) return;
    const root = (p.baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
    try {
      const res = await fetch(`${root}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ model: p.model }),
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) return;
      const ctx = contextFromOllamaShow(await res.json());
      if (ctx) p.contextWindow = ctx;
    } catch { /* Ollama may be off; the estimate remains in place. */ }
  }));
}

/**
 * Best-effort probe of LM Studio's REST API for the ACTUAL loaded context
 * length of each served model, so the client never has to guess the window
 * from the model name. Only `loaded_context_length` is trusted — a model's
 * max context says nothing about what it will be loaded with. Failures are
 * silent: the client falls back to its name-based heuristics.
 */
async function attachContextWindows(profiles: ProfileStatus[]): Promise<void> {
  const origins = new Set<string>();
  for (const p of profiles) {
    if (p.provider !== "openai-compatible" || !p.baseUrl) continue;
    try { origins.add(new URL(p.baseUrl).origin); } catch { /* malformed baseUrl */ }
  }
  if (!origins.size) return;

  const loaded = new Map<string, number>();
  await Promise.all([...origins].map(async (origin) => {
    try {
      const res = await fetch(`${origin}/api/v0/models`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return;
      const json = await res.json() as { data?: Array<{ id?: string; loaded_context_length?: number }> };
      for (const m of json.data || []) {
        if (m.id && m.loaded_context_length) loaded.set(`${origin}|${m.id}`, m.loaded_context_length);
      }
    } catch { /* not LM Studio, or server down — heuristics apply */ }
  }));

  for (const p of profiles) {
    if (p.provider !== "openai-compatible" || !p.baseUrl) continue;
    try {
      const ctx = loaded.get(`${new URL(p.baseUrl).origin}|${p.model}`);
      if (ctx) p.contextWindow = ctx;
    } catch { /* malformed baseUrl */ }
  }
}

export async function GET() {
  try {
    await requireUser();
    const status = publicLLMStatus();
    for (const p of status.profiles as ProfileStatus[]) {
      const estimated = estimatedModelContextWindow(p);
      if (estimated) p.contextWindow = estimated;
    }
    await attachContextWindows(status.profiles as ProfileStatus[]);
    await attachOllamaContextWindows(status.profiles as ProfileStatus[]);
    return NextResponse.json(status);
  } catch (err) {
    return toErrorResponse(err);
  }
}
