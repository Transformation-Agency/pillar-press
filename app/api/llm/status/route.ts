import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { publicLLMStatus } from "@/lib/llm";
import { toErrorResponse } from "@/lib/errors";

type ProfileStatus = {
  provider: string;
  model: string;
  baseUrl: string | null;
  contextWindow?: number;
};

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
    await attachContextWindows(status.profiles as ProfileStatus[]);
    return NextResponse.json(status);
  } catch (err) {
    return toErrorResponse(err);
  }
}
