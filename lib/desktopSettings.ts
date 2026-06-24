import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";

const DESKTOP_SECRET_PREFIX = "kpenc:v1:";

type Env = Record<string, string | undefined>;

export interface DesktopMediaProviderSettings {
  apiKey?: string;
  baseUrl?: string;
}

export interface DesktopLLMProfileSettings {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface DesktopSettingsFile {
  mediaProviders?: Record<string, DesktopMediaProviderSettings>;
  profiles?: DesktopLLMProfileSettings[];
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
    const mediaProviders = parsed.mediaProviders && typeof parsed.mediaProviders === "object"
      ? Object.fromEntries(
          Object.entries(parsed.mediaProviders as Record<string, unknown>)
            .filter(([, value]) => value && typeof value === "object")
            .map(([provider, value]) => {
              const raw = value as Record<string, unknown>;
              return [provider, {
                apiKey: typeof raw.apiKey === "string" ? decryptDesktopSecret(raw.apiKey, env) : undefined,
                baseUrl: typeof raw.baseUrl === "string" ? trim(raw.baseUrl) : undefined,
              }];
            }),
        )
      : undefined;
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles
          .map((profile): DesktopLLMProfileSettings | null => {
            if (!profile || typeof profile !== "object") return null;
            const raw = profile as Record<string, unknown>;
            const provider = typeof raw.provider === "string" ? trim(raw.provider)?.toLowerCase() : undefined;
            if (!provider) return null;
            return {
              provider,
              apiKey: typeof raw.apiKey === "string" ? decryptDesktopSecret(raw.apiKey, env) : undefined,
              baseUrl: typeof raw.baseUrl === "string" ? trim(raw.baseUrl) : undefined,
            };
          })
          .filter((profile): profile is DesktopLLMProfileSettings => Boolean(profile))
      : undefined;
    return { mediaProviders, profiles };
  } catch {
    return null;
  }
}

export function desktopMediaProvider(provider: string, env: Env = process.env): DesktopMediaProviderSettings | null {
  const settings = readDesktopSettings(env);
  const saved = settings?.mediaProviders?.[provider];
  if (saved?.apiKey || saved?.baseUrl) return saved;
  const profile = settings?.profiles?.find((item) => item.provider === provider && item.apiKey);
  if (!profile) return null;
  return {
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
  };
}
