import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/errors";

const Body = z.object({
  provider: z.enum(["openai", "openai-compatible", "xai"]).default("openai-compatible"),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
});

type ModelsResponse = {
  data?: Array<{ id?: string }>;
  models?: Array<{ name?: string; id?: string } | string>;
};

function normalizeModels(payload: ModelsResponse): string[] {
  const fromData = Array.isArray(payload.data) ? payload.data.map((m) => m.id) : [];
  const fromModels = Array.isArray(payload.models)
    ? payload.models.map((m) => (typeof m === "string" ? m : m.name || m.id))
    : [];
  return [...fromData, ...fromModels]
    .filter((m): m is string => Boolean(m && m.trim()))
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .sort((a, b) => a.localeCompare(b));
}

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const url = `${body.baseUrl.replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body.apiKey?.trim()) headers.Authorization = `Bearer ${body.apiKey.trim()}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      return NextResponse.json({ models: [], error: "Could not list models from this provider." }, { status: res.status });
    }
    const payload = (await res.json()) as ModelsResponse;
    return NextResponse.json({ models: normalizeModels(payload) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
