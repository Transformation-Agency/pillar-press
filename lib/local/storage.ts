import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localStorageDir } from "@/lib/local/paths";

export function localStorageConfigured(): boolean {
  return process.env.STORAGE_PROVIDER === "local" || process.env.KINGS_PRESS_STORAGE === "local" || !process.env.SUPABASE_URL;
}

export function isLocalStoredUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith("/api/local-files/");
}

function safeSegment(segment: string): string {
  return (segment || "file").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 160) || "file";
}

export function writeLocalPublicFile(
  bytes: Buffer | Uint8Array,
  name: string,
  contentType: string,
  prefix = "file",
): string {
  const safePrefix = safeSegment(prefix);
  const safeName = safeSegment(name);
  const storageDir = join(localStorageDir(), safePrefix);
  mkdirSync(storageDir, { recursive: true });
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
  writeFileSync(join(storageDir, filename), new Uint8Array(bytes));
  return `/api/local-files/${encodeURIComponent(safePrefix)}/${encodeURIComponent(filename)}?contentType=${encodeURIComponent(contentType || "application/octet-stream")}`;
}
