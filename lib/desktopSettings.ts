import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";

const DESKTOP_SECRET_PREFIX = "kpenc:v1:";

type Env = Record<string, string | undefined>;

export interface DesktopMediaProviderSettings {
  apiKey?: string;
  baseUrl?: string;
}

export interface DesktopSettingsFile {
  mediaProviders?: Record<string, DesktopMediaProviderSettings>;
  integrations?: Record<string, DesktopMediaProviderSettings>;
}

function trim(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function decryptDesktopSecret(value: string | undefined, env: Env = process.env): string | undefined {
  const raw = trim(value);
  if (!raw) return undefined;
  if (!raw.startsWith(DESKTOP_SECRET_PREFIX)) return raw;
  const keyText = trim(env.KINGS_PRESS_DESKTOP_SETTINGS_KEY);
  if (!keyText) return undefined;
  try {
    const payload = raw.slice(DESKTOP_SECRET_PREFIX.length);
    const [nonceText, ciphertextText] = payload.split(":");
    if (!nonceText || !ciphertextText) return undefined;
    const key = Buffer.from(keyText, "base64");
    const nonce = Buffer.from(nonceText, "base64");
    const encrypted = Buffer.from(ciphertextText, "base64");
    if (key.length !== 32 || nonce.length !== 12 || encrypted.length < 17) return undefined;
    const tag = encrypted.subarray(encrypted.length - 16);
    const ciphertext = encrypted.subarray(0, encrypted.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return trim(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  } catch {
    return undefined;
  }
}

export function readDesktopSettings(env: Env = process.env): DesktopSettingsFile | null {
  const path = trim(env.KINGS_PRESS_LLM_SETTINGS_PATH);
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return {
      mediaProviders: decryptProviderMap(parsed.mediaProviders, env),
      integrations: decryptProviderMap(parsed.integrations, env),
    };
  } catch {
    return null;
  }
}

function decryptProviderMap(value: unknown, env: Env): Record<string, DesktopMediaProviderSettings> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry && typeof entry === "object")
      .map(([provider, entry]) => {
        const raw = entry as Record<string, unknown>;
        return [provider, {
          apiKey: typeof raw.apiKey === "string" ? decryptDesktopSecret(raw.apiKey, env) : undefined,
          baseUrl: typeof raw.baseUrl === "string" ? trim(raw.baseUrl) : undefined,
        }];
      }),
  );
}

export function desktopMediaProvider(provider: string, env: Env = process.env): DesktopMediaProviderSettings | null {
  const settings = readDesktopSettings(env);
  return settings?.mediaProviders?.[provider] ?? null;
}

/** Decrypted Gather connector key saved from the desktop settings UI, if any. */
export function desktopIntegrationKey(integration: string, env: Env = process.env): string | undefined {
  const settings = readDesktopSettings(env);
  return trim(settings?.integrations?.[integration]?.apiKey);
}
