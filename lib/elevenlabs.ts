/**
 * ElevenLabs API client — SERVER ONLY.
 *
 * Reads ELEVENLABS_API_KEY from the server runtime. Used to generate the
 * voiceover audio that Hedra avatar/animation generations sync to.
 *
 * In the Pillar Press flow: generate TTS here -> upload the resulting audio
 * to Hedra as an asset (hedra.createAsset + hedra.uploadAsset) -> pass that
 * audio_asset_id into hedra.generateAsset for an avatar/lip-synced video.
 */

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";

export class ElevenError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ElevenError";
  }
}

function apiKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new ElevenError(500, "config", "Missing ELEVENLABS_API_KEY in server environment.");
  return k;
}

export interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
}

export async function listVoices(): Promise<ElevenVoice[]> {
  const res = await fetch(`${ELEVEN_BASE}/voices`, {
    headers: { "xi-api-key": apiKey() },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw mapError(res.status, await res.text().catch(() => ""));
  const json = (await res.json()) as { voices: ElevenVoice[] };
  return json.voices ?? [];
}

export interface TtsInput {
  text: string;
  voiceId: string;
  modelId?: string;       // e.g. "eleven_multilingual_v2"
  stability?: number;
  similarityBoost?: number;
  format?: string;        // e.g. "mp3_44100_128"
}

/** Returns the rendered audio as a Blob (audio/mpeg by default). */
export async function textToSpeech(input: TtsInput): Promise<Blob> {
  if (!input.text?.trim()) throw new ElevenError(422, "validation", "TTS text is empty.");
  if (input.text.length > 5000) throw new ElevenError(422, "validation", "TTS text exceeds 5000 characters.");
  const res = await fetch(
    `${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=${input.format ?? "mp3_44100_128"}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: input.text,
        model_id: input.modelId ?? "eleven_multilingual_v2",
        voice_settings: { stability: input.stability ?? 0.5, similarity_boost: input.similarityBoost ?? 0.75 },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) throw mapError(res.status, await res.text().catch(() => ""));
  return await res.blob();
}

function mapError(status: number, raw: string): ElevenError {
  if (status === 401) return new ElevenError(401, "auth", "ElevenLabs rejected the API key.");
  if (status === 422) return new ElevenError(422, "validation", "ElevenLabs rejected the request parameters.");
  if (status === 429) return new ElevenError(429, "rate_limit", "ElevenLabs rate limit hit. Try again shortly.");
  return new ElevenError(status >= 500 ? 502 : status, "upstream", "ElevenLabs request failed.", { snippet: raw.slice(0, 200) });
}
