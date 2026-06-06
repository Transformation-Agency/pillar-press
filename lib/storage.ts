/**
 * Supabase Storage upload (server-side). Used for generated audio: long
 * voiceovers can't be returned inline (they'd exceed the serverless response
 * limit), so we store the MP3 in the public "audio" bucket and persist its URL.
 *
 * Uploads with the anon key against the bucket's anon-insert policy. Public
 * read serves a stable URL.
 */
const supaUrl = () => (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const supaKey = () => process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export function storageConfigured(): boolean {
  return !!(supaUrl() && supaKey());
}

/** Upload MP3 bytes to the public "audio" bucket; returns the public URL. */
export async function uploadPublicAudio(bytes: Buffer | Uint8Array, name: string): Promise<string> {
  const base = supaUrl();
  const key = supaKey();
  if (!base || !key) throw new Error("Supabase storage is not configured.");
  const safe = (name || "audio.mp3").replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `voice/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const res = await fetch(`${base}/storage/v1/object/audio/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Audio upload failed (${res.status}): ${detail.slice(0, 160)}`);
  }
  return `${base}/storage/v1/object/public/audio/${path}`;
}
