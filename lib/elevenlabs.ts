/**
 * ElevenLabs API client — SERVER ONLY.
 *
 * Reads ELEVENLABS_API_KEY from the server runtime. Used to generate the
 * voiceover audio that Hedra avatar/animation generations sync to.
 *
 * In the King's Press flow: generate TTS here -> upload the resulting audio
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
  previousText?: string;  // preceding chunk's tail — improves seam prosody
  nextText?: string;      // following chunk's head — improves seam prosody
}

// Per-request cap. eleven_multilingual_v2 accepts up to ~10k chars; longer
// scripts are split + stitched by textToSpeechLong().
const TTS_MAX_CHARS = 9500;

/** Returns the rendered audio as a Blob (audio/mpeg by default). */
export async function textToSpeech(input: TtsInput): Promise<Blob> {
  if (!input.text?.trim()) throw new ElevenError(422, "validation", "TTS text is empty.");
  if (input.text.length > 10000) throw new ElevenError(422, "validation", "TTS text exceeds 10000 characters.");
  const res = await fetch(
    `${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=${input.format ?? "mp3_44100_128"}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: input.text,
        model_id: input.modelId ?? "eleven_multilingual_v2",
        voice_settings: { stability: input.stability ?? 0.5, similarity_boost: input.similarityBoost ?? 0.75 },
        ...(input.previousText ? { previous_text: input.previousText } : {}),
        ...(input.nextText ? { next_text: input.nextText } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) throw mapError(res.status, await res.text().catch(() => ""));
  return await res.blob();
}

/** Split long text into TTS-sized chunks on paragraph, then sentence, boundaries. */
function chunkForTTS(text: string, maxChars: number): string[] {
  const paras = String(text || "").split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = "";
  const flush = () => { const t = cur.trim(); if (t) chunks.push(t); cur = ""; };
  for (const p of paras) {
    if (p.length > maxChars) {
      flush();
      const sents = p.match(/[^.!?]+[.!?]+[\s"'’”)]*|[^.!?]+$/g) || [p];
      let s = "";
      for (const sent of sents) {
        if (sent.length > maxChars) {
          if (s.trim()) { chunks.push(s.trim()); s = ""; }
          for (let i = 0; i < sent.length; i += maxChars) chunks.push(sent.slice(i, i + maxChars));
          continue;
        }
        if ((s + sent).length > maxChars && s) { chunks.push(s.trim()); s = ""; }
        s += sent;
      }
      if (s.trim()) chunks.push(s.trim());
    } else if ((cur + "\n\n" + p).length > maxChars && cur) {
      flush(); cur = p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  flush();
  return chunks.length ? chunks : [String(text || "")];
}

/**
 * Synthesize text of any length: split into ≤maxChars chunks, render each with
 * previous/next-text context for seam continuity, and concatenate the MP3 bytes
 * into one Buffer.
 */
export async function textToSpeechLong(input: TtsInput, maxChars = TTS_MAX_CHARS): Promise<Buffer> {
  const text = (input.text || "").trim();
  if (!text) throw new ElevenError(422, "validation", "TTS text is empty.");
  const chunks = chunkForTTS(text, maxChars);
  const buffers: Buffer[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const blob = await textToSpeech({
      ...input,
      text: chunks[i],
      previousText: i > 0 ? chunks[i - 1].slice(-400) : undefined,
      nextText: i < chunks.length - 1 ? chunks[i + 1].slice(0, 400) : undefined,
    });
    buffers.push(Buffer.from(await blob.arrayBuffer()));
  }
  return Buffer.concat(buffers);
}

function mapError(status: number, raw: string): ElevenError {
  if (status === 401) return new ElevenError(401, "auth", "ElevenLabs rejected the API key.");
  if (status === 422) return new ElevenError(422, "validation", "ElevenLabs rejected the request parameters.");
  if (status === 429) return new ElevenError(429, "rate_limit", "ElevenLabs rate limit hit. Try again shortly.");
  return new ElevenError(status >= 500 ? 502 : status, "upstream", "ElevenLabs request failed.", { snippet: raw.slice(0, 200) });
}
