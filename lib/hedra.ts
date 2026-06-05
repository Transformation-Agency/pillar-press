/**
 * Hedra API client — SERVER ONLY.
 *
 * Reads HEDRA_API_KEY from the server runtime and never returns it to the
 * caller. Import this only from server code (route handlers / server actions).
 * The browser must talk to your own /api/hedra/* routes, never to Hedra
 * directly, so the key and arbitrary endpoint paths are never exposed.
 *
 * Base URL + auth header per Hedra's public web-app API:
 *   https://api.hedra.com/web-app/public   with header  X-API-Key: <key>
 */

const HEDRA_BASE = "https://api.hedra.com/web-app/public";

export class HedraError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HedraError";
  }
}

function apiKey(): string {
  const k = process.env.HEDRA_API_KEY;
  if (!k) throw new HedraError(500, "config", "Missing HEDRA_API_KEY in server environment.");
  return k;
}

// ---- shared types (subset; extend as Hedra's schema grows) ----
export type GenerationType = "image" | "video" | "audio";

export interface HedraModel {
  id: string;
  name?: string;
  type: GenerationType;
  description?: string;
  // capability metadata used to drive the UI + validation
  aspect_ratios?: string[];
  resolutions?: string[];
  durations?: number[];
  max_duration?: number;
  requires_start_frame?: boolean;
  requires_end_frame?: boolean;
  requires_audio?: boolean;
  requires_input_video?: boolean;
  credits?: number;
}

export interface HedraCredits { credits: number; [k: string]: unknown }
export interface HedraVoice { id: string; name?: string; [k: string]: unknown }
export interface HedraAsset { id: string; type: string; url?: string; name?: string; [k: string]: unknown }

export interface GenerationStatus {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "canceled" | string;
  progress?: number;
  url?: string;
  download_url?: string;
  thumbnail_url?: string;
  error?: string;
  [k: string]: unknown;
}

export interface GenerateInput {
  type: GenerationType;
  model_id: string;
  prompt?: string;
  text?: string;            // for TTS
  start_asset_id?: string;
  end_asset_id?: string;
  audio_asset_id?: string;
  voice_id?: string;
  aspect_ratio?: string;
  resolution?: string;
  duration?: number;
  [k: string]: unknown;
}

type FetchOpts = { method?: string; query?: Record<string, string | string[] | undefined>; body?: unknown; isForm?: boolean };

async function hedra<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const url = new URL(HEDRA_BASE + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v == null) continue;
    (Array.isArray(v) ? v : [v]).forEach((x) => url.searchParams.append(k, x));
  }
  const headers: Record<string, string> = { "X-API-Key": apiKey() };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.isForm) body = opts.body as FormData; // browser/server FormData; do not set Content-Type
    else { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "GET", headers, body, signal: AbortSignal.timeout(30_000) });
  } catch (e: any) {
    if (e?.name === "TimeoutError") throw new HedraError(504, "timeout", "Hedra request timed out.");
    throw new HedraError(502, "network", "Could not reach Hedra.");
  }

  if (!res.ok) {
    // Read the body for logging but NEVER surface raw provider text (may echo inputs).
    const text = await res.text().catch(() => "");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    throw mapHedraError(res.status, parsed, text);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function mapHedraError(status: number, parsed: unknown, raw: string): HedraError {
  switch (status) {
    case 401:
    case 403:
      return new HedraError(status, "auth", "Hedra rejected the API key.", parsed);
    case 402:
      return new HedraError(402, "insufficient_credits", "Not enough Hedra credits for this generation.", parsed);
    case 422:
      return new HedraError(422, "validation", "Hedra rejected the request parameters.", parsed);
    case 429:
      return new HedraError(429, "rate_limit", "Hedra rate limit hit. Try again shortly.", parsed);
    default:
      // log raw server-side (caller logs), but message stays generic
      return new HedraError(status >= 500 ? 502 : status, "upstream", "Hedra request failed.", { snippet: raw.slice(0, 200) });
  }
}

// ---- public, allowlisted operations ----

export function listModels(types?: GenerationType[]): Promise<HedraModel[]> {
  return hedra<HedraModel[]>("/models", { query: { type: types } });
}

export function getCredits(): Promise<HedraCredits> {
  return hedra<HedraCredits>("/credits");
}

export function listVoices(): Promise<HedraVoice[]> {
  return hedra<HedraVoice[]>("/voices");
}

export function listAssets(query?: { type?: string }): Promise<HedraAsset[]> {
  return hedra<HedraAsset[]>("/assets", { query });
}

/** Create an asset record (e.g. register an image/audio you will upload to). */
export function createAsset(input: { name: string; type: string }): Promise<HedraAsset> {
  return hedra<HedraAsset>("/assets", { method: "POST", body: input });
}

/** Upload binary data for an asset. `file` is a Blob/File on the server. */
export function uploadAsset(assetId: string, file: Blob, filename: string): Promise<HedraAsset> {
  const form = new FormData();
  form.append("file", file, filename);
  return hedra<HedraAsset>(`/assets/${encodeURIComponent(assetId)}/upload`, { method: "POST", body: form, isForm: true });
}

export function generateAsset(input: GenerateInput): Promise<GenerationStatus> {
  return hedra<GenerationStatus>("/generations", { method: "POST", body: input });
}

export function getGenerationStatus(generationId: string): Promise<GenerationStatus> {
  return hedra<GenerationStatus>(`/generations/${encodeURIComponent(generationId)}/status`);
}

export function listGenerations(filters?: { type?: string; status?: string; limit?: number }): Promise<GenerationStatus[]> {
  return hedra<GenerationStatus[]>("/generations", {
    query: { type: filters?.type, status: filters?.status, limit: filters?.limit?.toString() },
  });
}
