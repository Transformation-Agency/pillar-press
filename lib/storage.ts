import {
  isLocalStoredUrl,
  localStorageConfigured,
  writeLocalPublicFile,
} from "@/lib/local/storage";

/**
 * Public media storage (server-side).
 *
 * Desktop/local-first mode writes generated media into the King’s Press app-data
 * folder and serves it through /api/local-files. Supabase Storage remains only
 * as a compatibility path for legacy hosted/web setups.
 */
const supaUrl = () => (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const supaKey = () => process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export function storageConfigured(): boolean {
  return localStorageConfigured() || !!(supaUrl() && supaKey());
}

// Everything is stored in the one public bucket ("audio"); the prefix keeps
// kinds tidy (voice/, image/). The bucket name is just an id.
const BUCKET = "audio";

/** True if a URL already points at our own public storage (so we don't re-upload). */
export function isStoredUrl(url: string | null | undefined): boolean {
  return isLocalStoredUrl(url) || (!!url && url.includes(`/storage/v1/object/public/${BUCKET}/`));
}

/**
 * Upload arbitrary bytes to the public bucket and return a stable public URL.
 * Used for any generated media we must keep past the provider's short-lived,
 * signed URLs (audio MP3s, and Hedra images whose signed CDN URLs expire ~1h).
 */
export async function uploadPublicFile(
  bytes: Buffer | Uint8Array,
  name: string,
  contentType: string,
  prefix = "file",
): Promise<string> {
  const base = supaUrl();
  const key = supaKey();
  if (localStorageConfigured()) {
    return writeLocalPublicFile(bytes, name, contentType, prefix);
  }
  if (!base || !key) throw new Error("Supabase storage is not configured.");
  const ct = contentType || "application/octet-stream";
  const safe = (name || "file").replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": ct,
      "x-upsert": "true",
    },
    body: new Blob([new Uint8Array(bytes)], { type: ct }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${detail.slice(0, 160)}`);
  }
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Upload MP3 bytes to the public bucket; returns the public URL. */
export async function uploadPublicAudio(bytes: Buffer | Uint8Array, name: string): Promise<string> {
  return uploadPublicFile(bytes, name || "audio.mp3", "audio/mpeg", "voice");
}

/**
 * Fetch a (possibly short-lived, signed) media URL and persist a permanent copy
 * in our public bucket. `accept` guards the content-type ("image" or "video").
 * Returns the stable URL, or null if anything fails (the caller keeps the
 * original signed URL as a fallback).
 */
async function persistRemote(
  srcUrl: string,
  baseName: string,
  accept: "image" | "video",
): Promise<string | null> {
  try {
    if (!srcUrl || isStoredUrl(srcUrl) || !storageConfigured()) return null;
    const r = await fetch(srcUrl);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || (accept === "video" ? "video/mp4" : "image/png");
    if (!new RegExp(`^${accept}/`, "i").test(ct)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;
    let ext: string;
    if (accept === "video") {
      ext = /webm/i.test(ct) ? "webm" : /quicktime|mov/i.test(ct) ? "mov" : "mp4";
    } else {
      ext = /webp/i.test(ct) ? "webp" : /jpe?g/i.test(ct) ? "jpg" : /gif/i.test(ct) ? "gif" : "png";
    }
    return await uploadPublicFile(buf, `${baseName}.${ext}`, ct, accept);
  } catch {
    return null;
  }
}

/** Persist a signed image URL to permanent storage (or null on failure). */
export function persistRemoteImage(srcUrl: string, baseName: string): Promise<string | null> {
  return persistRemote(srcUrl, baseName, "image");
}

/** Persist a signed video URL to permanent storage (or null on failure). */
export function persistRemoteVideo(srcUrl: string, baseName: string): Promise<string | null> {
  return persistRemote(srcUrl, baseName, "video");
}
