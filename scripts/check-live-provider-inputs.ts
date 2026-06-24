import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

type Env = Record<string, string | undefined>;

export type ProviderInputSummary = {
  env: Record<string, boolean>;
  savedSettings: {
    path: string;
    exists: boolean;
    keychainSettingsKeyAvailable: boolean;
    llmProfilesWithKeys: string[];
    mediaProvidersWithKeys: string[];
  };
  releaseBlockerReadiness: {
    prov004OpenAI: "ready" | "missing";
    media002SpendFlag: boolean;
    media002Providers: Record<"openai" | "xai" | "elevenlabs" | "hedra", "ready" | "saved-only" | "missing">;
  };
};

const providerEnvKeys = {
  openai: ["KINGS_PRESS_LIVE_OPENAI_API_KEY", "OPENAI_API_KEY"],
  xai: ["KINGS_PRESS_LIVE_XAI_API_KEY", "KINGS_PRESS_LIVE_GROK_API_KEY", "XAI_API_KEY", "GROK_API_KEY"],
  elevenlabs: ["KINGS_PRESS_LIVE_ELEVENLABS_API_KEY", "ELEVENLABS_API_KEY"],
  hedra: ["KINGS_PRESS_LIVE_HEDRA_API_KEY", "HEDRA_API_KEY"],
} as const;

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

function envHasAny(env: Env, names: readonly string[]) {
  return names.some((name) => hasValue(env[name]));
}

function defaultSettingsPath(env: Env) {
  return env.KINGS_PRESS_LIVE_DESKTOP_SETTINGS_PATH?.trim()
    || join(homedir(), "Library", "Application Support", "com.kingspress.editorialdesk", "desktop-settings.json");
}

function keychainSettingsKeyAvailable() {
  if (process.platform !== "darwin") return false;
  try {
    const keychain = execFileSync("security", ["default-keychain", "-d", "user"], { encoding: "utf8" })
      .trim()
      .replace(/^"|"$/g, "");
    const secret = execFileSync("security", [
      "find-generic-password",
      "-w",
      "-s",
      "Kings Press Desktop Settings",
      "-a",
      "llm-settings",
      keychain,
    ], { encoding: "utf8" }).trim();
    return Buffer.from(secret, "base64").length === 32;
  } catch {
    return false;
  }
}

function providersFromSavedSettings(path: string) {
  const result = {
    llmProfilesWithKeys: [] as string[],
    mediaProvidersWithKeys: [] as string[],
  };
  if (!existsSync(path)) return result;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (Array.isArray(parsed.profiles)) {
      for (const profile of parsed.profiles) {
        if (!profile || typeof profile !== "object") continue;
        const raw = profile as Record<string, unknown>;
        if (typeof raw.provider === "string" && typeof raw.apiKey === "string" && raw.apiKey.trim()) {
          result.llmProfilesWithKeys.push(raw.provider.trim().toLowerCase());
        }
      }
    }
    if (parsed.mediaProviders && typeof parsed.mediaProviders === "object") {
      for (const [provider, value] of Object.entries(parsed.mediaProviders as Record<string, unknown>)) {
        if (value && typeof value === "object" && typeof (value as Record<string, unknown>).apiKey === "string") {
          if (String((value as Record<string, unknown>).apiKey).trim()) result.mediaProvidersWithKeys.push(provider.trim().toLowerCase());
        }
      }
    }
  } catch {
    return result;
  }
  result.llmProfilesWithKeys = Array.from(new Set(result.llmProfilesWithKeys)).sort();
  result.mediaProvidersWithKeys = Array.from(new Set(result.mediaProvidersWithKeys)).sort();
  return result;
}

export function summarizeLiveProviderInputs(env: Env = process.env): ProviderInputSummary {
  const path = defaultSettingsPath(env);
  const saved = providersFromSavedSettings(path);
  const savedProviders = new Set([...saved.llmProfilesWithKeys, ...saved.mediaProvidersWithKeys]);
  const providerReadiness = (provider: keyof typeof providerEnvKeys): "ready" | "saved-only" | "missing" => {
    if (envHasAny(env, providerEnvKeys[provider])) return "ready";
    return savedProviders.has(provider) ? "saved-only" : "missing";
  };

  return {
    env: {
      KINGS_PRESS_LIVE_OPENAI_API_KEY: hasValue(env.KINGS_PRESS_LIVE_OPENAI_API_KEY),
      KINGS_PRESS_LIVE_XAI_API_KEY: hasValue(env.KINGS_PRESS_LIVE_XAI_API_KEY),
      KINGS_PRESS_LIVE_GROK_API_KEY: hasValue(env.KINGS_PRESS_LIVE_GROK_API_KEY),
      KINGS_PRESS_LIVE_ELEVENLABS_API_KEY: hasValue(env.KINGS_PRESS_LIVE_ELEVENLABS_API_KEY),
      KINGS_PRESS_LIVE_HEDRA_API_KEY: hasValue(env.KINGS_PRESS_LIVE_HEDRA_API_KEY),
      KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS: env.KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS === "yes",
      KINGS_PRESS_LIVE_DESKTOP_SETTINGS_PATH: hasValue(env.KINGS_PRESS_LIVE_DESKTOP_SETTINGS_PATH),
    },
    savedSettings: {
      path,
      exists: existsSync(path),
      keychainSettingsKeyAvailable: keychainSettingsKeyAvailable(),
      llmProfilesWithKeys: saved.llmProfilesWithKeys,
      mediaProvidersWithKeys: saved.mediaProvidersWithKeys,
    },
    releaseBlockerReadiness: {
      prov004OpenAI: envHasAny(env, ["KINGS_PRESS_LIVE_OPENAI_API_KEY"]) ? "ready" : "missing",
      media002SpendFlag: env.KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS === "yes",
      media002Providers: {
        openai: providerReadiness("openai"),
        xai: providerReadiness("xai"),
        elevenlabs: providerReadiness("elevenlabs"),
        hedra: providerReadiness("hedra"),
      },
    },
  };
}

function main() {
  const summary = summarizeLiveProviderInputs();
  console.log(JSON.stringify(summary, null, 2));
  const { releaseBlockerReadiness } = summary;
  if (releaseBlockerReadiness.prov004OpenAI === "missing") {
    console.error("PROV-004 still needs KINGS_PRESS_LIVE_OPENAI_API_KEY for live OpenAI model/test evidence.");
  }
  if (!releaseBlockerReadiness.media002SpendFlag) {
    console.error("MEDIA-002 spend-credit generation still needs KINGS_PRESS_LIVE_PROVIDER_VERIFY_SPEND_CREDITS=yes.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
