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

export interface HedraCredits { remaining?: number; expiring?: number; used?: number; workspace_credits?: Record<string, number>; [k: string]: unknown }
export interface HedraVoice { id: string; name?: string; [k: string]: unknown }
export interface HedraAsset { id: string; type: string; url?: string; name?: string; [k: string]: unknown }

export interface GenerationStatus {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "canceled" | string;
  progress?: number;
  url?: string;
  download_url?: string;
  thumbnail_url?: string;
  asset_id?: string;
  error?: string;
  [k: string]: unknown;
}

/** Normalized internal generate request. generateAsset() maps this to Hedra's
 *  actual /generations body (flat for image; nested generated_video_inputs for
 *  video/avatar). Audio (TTS) is handled via ElevenLabs, not here. */
export interface GenerateInput {
  type: GenerationType; // "image" | "video"
  modelId: string;
  textPrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  startAssetId?: string; // start_keyframe_id (video/avatar)
  audioAssetId?: string; // audio_id (avatar lip-sync)
  durationMs?: number;
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
  // Hedra exposes the balance at /billing/credits ({ remaining, expiring, used,
  // workspace_credits }), not /credits.
  return hedra<HedraCredits>("/billing/credits");
}

export function listVoices(): Promise<HedraVoice[]> {
  return hedra<HedraVoice[]>("/voices");
}

export async function listAssets(query?: { type?: string }): Promise<HedraAsset[]> {
  const resp = await hedra<unknown>("/assets", { query });
  if (Array.isArray(resp)) return resp as HedraAsset[];
  const r = resp as { assets?: HedraAsset[]; data?: HedraAsset[] };
  return r.assets ?? r.data ?? [];
}

/** Resolve the public output URL(s) for a finished generation's asset. Hedra's
 *  status endpoint returns a null url for images — the rendered asset carries
 *  the url (nested under `asset.url`); GET /assets/:id 404s, so we list + match. */
export async function getAssetUrls(assetId: string, type = "image"): Promise<{ url?: string; thumbnailUrl?: string }> {
  // Hedra's /assets list REQUIRES a type filter (no-filter returns nothing).
  const assets = await listAssets({ type });
  const a = assets.find((x) => x && (x as { id?: string }).id === assetId) as
    | { url?: string; thumbnail_url?: string; asset?: { url?: string } }
    | undefined;
  if (!a) return {};
  return { url: a.asset?.url ?? a.url, thumbnailUrl: a.thumbnail_url };
}

// Hedra reports terminal image/video states as "complete"/"error"; normalize to
// the route's expected vocabulary.
function normalizeStatus(s: GenerationStatus): GenerationStatus {
  const raw = String(s.status ?? "");
  const status =
    raw === "complete" ? "completed" : raw === "error" ? "failed" : raw === "cancelled" ? "canceled" : raw;
  return { ...s, status };
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

// Hedra occasionally returns transient errors on submission (notably 422 for
// some image models, plus 429/5xx/timeouts). Retry those a few times with
// exponential backoff before giving up. A failed POST creates no generation, so
// re-submitting is safe (no duplicate/extra credit charge).
const TRANSIENT_STATUSES = new Set([408, 409, 422, 425, 429, 500, 502, 503, 504]);

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e instanceof HedraError ? e.status : 0;
      if (i === attempts - 1 || !TRANSIENT_STATUSES.has(status)) throw e;
      const delay = 500 * 2 ** i + Math.floor(Math.random() * 300);
      console.warn(`[hedra] transient ${status} on submit; retry ${i + 1}/${attempts - 1} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function generateAsset(input: GenerateInput): Promise<GenerationStatus> {
  let body: Record<string, unknown>;
  if (input.type === "image") {
    // Flat body for image generation.
    body = { type: "image", ai_model_id: input.modelId, text_prompt: input.textPrompt ?? "" };
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
    if (input.resolution) body.resolution = input.resolution;
    // Image-to-image models require a start frame (validated by requires_start_frame).
    if (input.startAssetId) body.start_keyframe_id = input.startAssetId;
  } else {
    // video / avatar: inputs nested under generated_video_inputs.
    const vi: Record<string, unknown> = { text_prompt: input.textPrompt ?? "" };
    if (input.aspectRatio) vi.aspect_ratio = input.aspectRatio;
    if (input.resolution) vi.resolution = input.resolution;
    if (input.durationMs) vi.duration_ms = input.durationMs;
    body = { type: "video", ai_model_id: input.modelId, generated_video_inputs: vi };
    if (input.startAssetId) body.start_keyframe_id = input.startAssetId;
    if (input.audioAssetId) body.audio_id = input.audioAssetId;
  }
  const res = await withRetry(() => hedra<GenerationStatus>("/generations", { method: "POST", body }));
  return normalizeStatus(res);
}

export async function getGenerationStatus(generationId: string): Promise<GenerationStatus> {
  const res = await hedra<GenerationStatus>(`/generations/${encodeURIComponent(generationId)}/status`);
  return normalizeStatus(res);
}

export function listGenerations(filters?: { type?: string; status?: string; limit?: number }): Promise<GenerationStatus[]> {
  return hedra<GenerationStatus[]>("/generations", {
    query: { type: filters?.type, status: filters?.status, limit: filters?.limit?.toString() },
  });
}
