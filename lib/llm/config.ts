import { readFileSync } from "node:fs";
import { LLMError } from "@/lib/llm/errors";
import type { LLMCapabilities, LLMConfig, LLMProvider, LLMTask } from "@/lib/llm/types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_MAX_TOKENS = 32000;
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

const PROVIDERS = new Set<LLMProvider>(["anthropic", "openai", "openai-compatible", "xai", "ollama", "gemini"]);

export const LLM_TASKS: readonly LLMTask[] = [
  "gather",
  "weave",
  "draft",
  "review",
  "revision",
  "outputs",
  "utility",
  "mediaPrompt",
  "file",
] as const;

export const LLM_TASK_LABELS: Record<LLMTask, string> = {
  gather: "Gather",
  weave: "Weave",
  draft: "Draft",
  review: "Review",
  revision: "Revision",
  outputs: "Outputs",
  utility: "Utility",
  mediaPrompt: "Media prompts",
  file: "File extraction",
};

export const PROVIDER_CAPABILITIES: Record<LLMProvider, LLMCapabilities> = {
  anthropic: { text: true, json: true, vision: true, pdf: true },
  openai: { text: true, json: true, vision: false, pdf: false },
  "openai-compatible": { text: true, json: true, vision: false, pdf: false },
  xai: { text: true, json: true, vision: false, pdf: false },
  ollama: { text: true, json: true, vision: false, pdf: false },
  gemini: { text: true, json: true, vision: true, pdf: true },
};

type Env = Record<string, string | undefined>;
export interface DesktopLLMProfile {
  id: string;
  label?: string;
  provider?: LLMProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface DesktopLLMSettings {
  provider?: LLMProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  profiles?: DesktopLLMProfile[];
  defaultProfileId?: string;
  taskDefaults?: Partial<Record<LLMTask, string>>;
}

function asProvider(value: string | undefined, fallback?: LLMProvider): LLMProvider {
  const v = (value || fallback || "").trim();
  if (PROVIDERS.has(v as LLMProvider)) return v as LLMProvider;
  throw new LLMError(500, "llm_config", `Unsupported LLM provider: ${v || "(empty)"}.`);
}

function trim(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function trimBaseUrl(value: string | undefined): string | undefined {
  return trim(value)?.replace(/\/+$/, "");
}

function taskEnvKey(task: LLMTask): string {
  return task.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}

function isLocalFirstEnv(env: Env): boolean {
  return (
    env.KINGS_PRESS_LOCAL_FIRST === "true" ||
    env.DATA_BACKEND === "sqlite" ||
    Boolean(trim(env.KINGS_PRESS_DB_PATH))
  );
}

function readDesktopLLMSettings(env: Env): DesktopLLMSettings | null {
  const path = trim(env.KINGS_PRESS_LLM_SETTINGS_PATH);
  if (!path) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const provider = typeof parsed.provider === "string" && PROVIDERS.has(parsed.provider as LLMProvider)
      ? (parsed.provider as LLMProvider)
      : undefined;
    const model = typeof parsed.model === "string" ? trim(parsed.model) : undefined;
    const baseUrl = typeof parsed.baseUrl === "string" ? trimBaseUrl(parsed.baseUrl) : undefined;
    const apiKey = typeof parsed.apiKey === "string" ? trim(parsed.apiKey) : undefined;
    const profiles = Array.isArray(parsed.profiles)
      ? parsed.profiles
          .map((p): DesktopLLMProfile | null => {
            if (!p || typeof p !== "object") return null;
            const raw = p as Record<string, unknown>;
            const profileProvider = typeof raw.provider === "string" && PROVIDERS.has(raw.provider as LLMProvider)
              ? (raw.provider as LLMProvider)
              : undefined;
            const profileModel = typeof raw.model === "string" ? trim(raw.model) : undefined;
            const id = typeof raw.id === "string" ? trim(raw.id) : undefined;
            if (!id || !profileProvider || !profileModel) return null;
            return {
              id,
              label: typeof raw.label === "string" ? trim(raw.label) : undefined,
              provider: profileProvider,
              model: profileModel,
              baseUrl: typeof raw.baseUrl === "string" ? trimBaseUrl(raw.baseUrl) : undefined,
              apiKey: typeof raw.apiKey === "string" ? trim(raw.apiKey) : undefined,
            };
          })
          .filter((p): p is DesktopLLMProfile => !!p)
      : undefined;
    const taskDefaults = parsed.taskDefaults && typeof parsed.taskDefaults === "object"
      ? Object.fromEntries(
          Object.entries(parsed.taskDefaults as Record<string, unknown>)
            .filter(([task, profileId]) => (LLM_TASKS as readonly string[]).includes(task) && typeof profileId === "string" && trim(profileId)),
        ) as Partial<Record<LLMTask, string>>
      : undefined;
    return {
      provider,
      model,
      baseUrl,
      apiKey,
      profiles,
      defaultProfileId: typeof parsed.defaultProfileId === "string" ? trim(parsed.defaultProfileId) : undefined,
      taskDefaults,
    };
  } catch {
    return null;
  }
}

function desktopProfiles(settings: DesktopLLMSettings | null): DesktopLLMProfile[] {
  const profiles = settings?.profiles?.filter((p) => p.provider && p.model) ?? [];
  if (profiles.length) return profiles;
  if (!settings?.model) return [];
  return [{
    id: "default",
    label: "Default",
    provider: settings.provider ?? "ollama",
    model: settings.model,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
  }];
}

function findDesktopProfile(settings: DesktopLLMSettings | null, profileId: string | undefined): DesktopLLMProfile | undefined {
  const profiles = desktopProfiles(settings);
  if (!profiles.length) return undefined;
  return profiles.find((p) => p.id === profileId) ?? undefined;
}

function defaultDesktopProfile(settings: DesktopLLMSettings | null): DesktopLLMProfile | undefined {
  const profiles = desktopProfiles(settings);
  if (!profiles.length) return undefined;
  return profiles.find((p) => p.id === settings?.defaultProfileId) ?? profiles[0];
}

function maxTokens(value: string | undefined): number {
  const n = Number.parseInt(value || "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

function providerEnvApiKey(provider: LLMProvider, env: Env): string | undefined {
  if (provider === "anthropic") return trim(env.ANTHROPIC_API_KEY);
  if (provider === "openai") return trim(env.OPENAI_API_KEY);
  if (provider === "xai") return trim(env.XAI_API_KEY) || trim(env.GROK_API_KEY);
  if (provider === "gemini") return trim(env.GEMINI_API_KEY) || trim(env.GOOGLE_API_KEY);
  return undefined;
}

function defaultModel(provider: LLMProvider): string {
  if (provider === "anthropic") return DEFAULT_ANTHROPIC_MODEL;
  if (provider === "gemini") return DEFAULT_GEMINI_MODEL;
  return "";
}

function defaultBaseUrl(provider: LLMProvider): string | undefined {
  if (provider === "ollama") return DEFAULT_OLLAMA_BASE_URL;
  if (provider === "openai") return DEFAULT_OPENAI_BASE_URL;
  if (provider === "xai") return DEFAULT_XAI_BASE_URL;
  if (provider === "gemini") return DEFAULT_GEMINI_BASE_URL;
  return undefined;
}

function finalizeConfig(
  provider: LLMProvider,
  env: Env,
  input: { model?: string; baseUrl?: string; apiKey?: string; maxTokens?: string },
): LLMConfig {
  const model = trim(input.model) || defaultModel(provider);
  if (!model) throw new LLMError(500, "llm_config", "Missing LLM_MODEL in server environment.", provider);

  const apiKey = trim(input.apiKey) || providerEnvApiKey(provider, env);
  const baseUrl = trimBaseUrl(input.baseUrl) || defaultBaseUrl(provider);

  if (provider === "anthropic" && !apiKey) {
    throw new LLMError(500, "llm_config", "Missing LLM_API_KEY or ANTHROPIC_API_KEY in server environment.", provider);
  }
  if (provider === "openai-compatible" && !baseUrl) {
    throw new LLMError(500, "llm_config", "Missing LLM_BASE_URL for openai-compatible provider.", provider);
  }
  if (provider === "openai" && !apiKey) {
    throw new LLMError(500, "llm_config", "Missing LLM_API_KEY or OPENAI_API_KEY in server environment.", provider);
  }
  if (provider === "xai" && !apiKey) {
    throw new LLMError(500, "llm_config", "Missing LLM_API_KEY, XAI_API_KEY, or GROK_API_KEY in server environment.", provider);
  }
  if (provider === "gemini" && !apiKey) {
    throw new LLMError(500, "llm_config", "Missing LLM_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY in server environment.", provider);
  }

  return { provider, model, maxTokens: maxTokens(input.maxTokens ?? env.LLM_MAX_TOKENS), apiKey, baseUrl };
}

export function resolveMainLLMConfig(env: Env = process.env): LLMConfig {
  const desktop = readDesktopLLMSettings(env);
  const desktopDefault = defaultDesktopProfile(desktop);
  const provider = env.LLM_PROVIDER
    ? asProvider(env.LLM_PROVIDER)
    : env.ANTHROPIC_API_KEY
      ? "anthropic"
      : isLocalFirstEnv(env)
        ? asProvider(desktopDefault?.provider ?? desktop?.provider, "ollama")
        : asProvider(undefined, "anthropic");

  const desktopModel =
    !env.LLM_PROVIDER || desktopDefault?.provider === provider || desktop?.provider === provider || (!desktopDefault?.provider && !desktop?.provider && provider === "ollama")
      ? desktopDefault?.model ?? desktop?.model
      : undefined;
  const sameDesktopProvider = desktopDefault?.provider === provider || desktop?.provider === provider || (!env.LLM_PROVIDER && provider === "ollama");
  return finalizeConfig(provider, env, {
    model: trim(env.LLM_MODEL) || desktopModel,
    apiKey: trim(env.LLM_API_KEY) || (sameDesktopProvider ? desktopDefault?.apiKey ?? desktop?.apiKey : undefined),
    baseUrl: trimBaseUrl(env.LLM_BASE_URL) || (sameDesktopProvider ? desktopDefault?.baseUrl ?? desktop?.baseUrl : undefined),
  });
}

export function resolveTaskLLMConfig(task: LLMTask, env: Env = process.env): LLMConfig {
  if (!LLM_TASKS.includes(task)) {
    throw new LLMError(500, "llm_config", `Unsupported LLM task: ${task}.`);
  }
  const desktop = readDesktopLLMSettings(env);
  const key = taskEnvKey(task);
  const taskProvider = trim(env[`LLM_TASK_${key}_PROVIDER`]) || trim(env[`LLM_${key}_PROVIDER`]);
  const taskModel = trim(env[`LLM_TASK_${key}_MODEL`]) || trim(env[`LLM_${key}_MODEL`]);
  const taskBaseUrl = trimBaseUrl(env[`LLM_TASK_${key}_BASE_URL`]) || trimBaseUrl(env[`LLM_${key}_BASE_URL`]);
  const taskApiKey = trim(env[`LLM_TASK_${key}_API_KEY`]) || trim(env[`LLM_${key}_API_KEY`]);
  const taskProfileId = trim(env[`LLM_TASK_${key}_PROFILE`]) || trim(env[`LLM_${key}_PROFILE`]) || desktop?.taskDefaults?.[task];
  const taskProfile = findDesktopProfile(desktop, taskProfileId);
  const hasTaskOverride = !!(taskProvider || taskModel || taskBaseUrl || taskApiKey || taskProfile);

  if (!hasTaskOverride) return resolveMainLLMConfig(env);

  const main = taskProvider ? null : (() => {
    try { return resolveMainLLMConfig(env); } catch { return null; }
  })();
  const provider = taskProvider ? asProvider(taskProvider) : asProvider(taskProfile?.provider ?? main?.provider);
  return finalizeConfig(provider, env, {
    model: taskModel || (taskProfile?.provider === provider ? taskProfile.model : undefined) || (main?.provider === provider ? main.model : undefined),
    apiKey: taskApiKey || (taskProfile?.provider === provider ? taskProfile.apiKey : undefined) || (main?.provider === provider ? main.apiKey : undefined),
    baseUrl: taskBaseUrl || (taskProfile?.provider === provider ? taskProfile.baseUrl : undefined) || (main?.provider === provider ? main.baseUrl : undefined),
  });
}

export function resolveFileLLMConfig(env: Env = process.env): LLMConfig | null {
  const main = resolveMainLLMConfig(env);
  const explicitProvider = trim(env.LLM_FILE_PROVIDER);
  const provider = explicitProvider ? asProvider(explicitProvider) : main.provider;

  const model =
    trim(env.LLM_FILE_MODEL) ||
    (provider === main.provider ? main.model : undefined) ||
    (provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : provider === "gemini" ? DEFAULT_GEMINI_MODEL : "");
  if (!model) throw new LLMError(500, "llm_config", "Missing LLM_FILE_MODEL for file provider.", provider);

  const apiKey =
    trim(env.LLM_FILE_API_KEY) ||
    (provider === main.provider ? main.apiKey : undefined) ||
    (provider === "anthropic" ? trim(env.ANTHROPIC_API_KEY) : undefined) ||
    (provider === "openai" ? trim(env.OPENAI_API_KEY) : undefined) ||
    (provider === "xai" ? trim(env.XAI_API_KEY) || trim(env.GROK_API_KEY) : undefined) ||
    (provider === "gemini" ? trim(env.GEMINI_API_KEY) || trim(env.GOOGLE_API_KEY) : undefined);
  const baseUrl =
    provider === "ollama"
      ? trimBaseUrl(env.LLM_FILE_BASE_URL) || (provider === main.provider ? main.baseUrl : undefined) || DEFAULT_OLLAMA_BASE_URL
      : provider === "openai"
        ? trimBaseUrl(env.LLM_FILE_BASE_URL) || (provider === main.provider ? main.baseUrl : undefined) || DEFAULT_OPENAI_BASE_URL
        : provider === "xai"
          ? trimBaseUrl(env.LLM_FILE_BASE_URL) || (provider === main.provider ? main.baseUrl : undefined) || DEFAULT_XAI_BASE_URL
      : provider === "gemini"
        ? trimBaseUrl(env.LLM_FILE_BASE_URL) || (provider === main.provider ? main.baseUrl : undefined) || DEFAULT_GEMINI_BASE_URL
        : trimBaseUrl(env.LLM_FILE_BASE_URL) || (provider === main.provider ? main.baseUrl : undefined);

  if (provider === "anthropic" && !apiKey) {
    return null;
  }
  if (provider === "openai-compatible" && !baseUrl) {
    throw new LLMError(500, "llm_config", "Missing LLM_FILE_BASE_URL for openai-compatible file provider.", provider);
  }
  if ((provider === "openai" || provider === "xai") && !apiKey) {
    return null;
  }
  if (provider === "gemini" && !apiKey) {
    return null;
  }

  return { provider, model, maxTokens: maxTokens(env.LLM_MAX_TOKENS), apiKey, baseUrl };
}

export function resolveAnthropicFileFallback(env: Env = process.env): LLMConfig | null {
  const apiKey = trim(env.LLM_FILE_API_KEY) || trim(env.ANTHROPIC_API_KEY);
  if (!apiKey) return null;
  return {
    provider: "anthropic",
    model: trim(env.LLM_FILE_MODEL) || DEFAULT_ANTHROPIC_MODEL,
    maxTokens: maxTokens(env.LLM_MAX_TOKENS),
    apiKey,
  };
}

export function publicLLMStatus(env: Env = process.env) {
  const desktop = readDesktopLLMSettings(env);
  let main: LLMConfig | { provider: LLMProvider; model: string | null };
  try {
    main = resolveMainLLMConfig(env);
  } catch (err) {
    if (!(err instanceof LLMError) || err.code !== "llm_config" || !isLocalFirstEnv(env)) {
      throw err;
    }
    const desktopDefault = defaultDesktopProfile(desktop);
    const provider = env.LLM_PROVIDER
      ? asProvider(env.LLM_PROVIDER)
      : env.ANTHROPIC_API_KEY
        ? "anthropic"
        : asProvider(desktopDefault?.provider ?? desktop?.provider, "ollama");
    const model =
      trim(env.LLM_MODEL) ||
      desktopDefault?.model ||
      desktop?.model ||
      (provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : provider === "gemini" ? DEFAULT_GEMINI_MODEL : null);
    main = { provider, model };
  }

  let fileFallback: LLMConfig | null = null;
  try {
    const file = resolveFileLLMConfig(env);
    fileFallback = file && PROVIDER_CAPABILITIES[file.provider].pdf && PROVIDER_CAPABILITIES[file.provider].vision
      ? file
      : resolveAnthropicFileFallback(env);
  } catch (err) {
    if (!(err instanceof LLMError) || err.code !== "llm_config" || !isLocalFirstEnv(env)) {
      throw err;
    }
    fileFallback = resolveAnthropicFileFallback(env);
  }

  const profiles = desktopProfiles(desktop).map((p) => ({
    id: p.id,
    label: p.label ?? p.model ?? p.id,
    provider: p.provider!,
    model: p.model!,
    baseUrl: p.baseUrl ?? null,
    hasApiKey: !!p.apiKey,
    capabilities: PROVIDER_CAPABILITIES[p.provider!],
  }));
  const tasks = Object.fromEntries(
    LLM_TASKS.map((task) => {
      const profileId = desktop?.taskDefaults?.[task] ?? desktop?.defaultProfileId ?? profiles[0]?.id ?? null;
      let resolved: LLMConfig | { provider: LLMProvider; model: string | null } | null = null;
      try {
        resolved = resolveTaskLLMConfig(task, env);
      } catch (err) {
        if (!(err instanceof LLMError) || err.code !== "llm_config" || !isLocalFirstEnv(env)) {
          throw err;
        }
        const profile = profileId ? findDesktopProfile(desktop, profileId) : undefined;
        resolved = profile
          ? { provider: profile.provider!, model: profile.model ?? null }
          : { provider: main.provider, model: main.model };
      }
      return [task, {
        label: LLM_TASK_LABELS[task],
        profileId,
        provider: resolved?.provider ?? main.provider,
        model: resolved?.model ?? null,
      }];
    }),
  );

  return {
    provider: main.provider,
    model: main.model,
    fileProvider: fileFallback?.provider ?? null,
    fileModel: fileFallback?.model ?? null,
    capabilities: {
      ...PROVIDER_CAPABILITIES[main.provider],
      file: fileFallback ? PROVIDER_CAPABILITIES[fileFallback.provider] : { text: false, json: false, vision: false, pdf: false },
    },
    profiles,
    defaultProfileId: desktop?.defaultProfileId ?? profiles[0]?.id ?? null,
    tasks,
  };
}
