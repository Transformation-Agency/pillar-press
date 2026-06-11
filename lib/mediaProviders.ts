import { desktopMediaProvider } from "@/lib/desktopSettings";
import type { SessionUser } from "@/lib/auth";
import { isLocalFirstMode } from "@/lib/local/mode";
import {
  getHostedMediaProviderProfileForProvider,
  getHostedMediaProviderSettings,
  type HostedMediaProviderProfileView,
  type MediaProvider,
} from "@/lib/mediaProviderSettings";

export type MediaProviderSource = "managed" | "byok";

export type MediaProviderStatus = {
  hedra: MediaProviderInfo;
  elevenlabs: MediaProviderInfo;
  openai: MediaProviderInfo;
  xai: MediaProviderInfo;
  customImage: MediaProviderInfo;
  providers: MediaProviderInfo[];
};

export type MediaCapability = "image" | "video" | "avatar" | "audio";

export type MediaModelInfo = {
  id: string;
  name: string;
  type: MediaCapability;
  provider: string;
  aspectRatios?: string[];
  resolutions?: string[];
  durations?: number[];
  credits?: number;
  requires?: Record<string, boolean>;
};

export type MediaProviderInfo = {
  id: string;
  label: string;
  configured: boolean;
  sources?: MediaProviderSource[];
  profileIds?: string[];
  capabilities: MediaCapability[];
  envVars: string[];
  models: MediaModelInfo[];
};

export type ImageProviderConfig = {
  provider: "openai" | "xai" | "custom-image";
  baseUrl: string;
  apiKey: string;
  providerSource?: MediaProviderSource;
  profileId?: string;
};

export type AudioProviderConfig = {
  provider: "openai";
  baseUrl: string;
  apiKey: string;
  providerSource?: MediaProviderSource;
  profileId?: string;
};

export type MediaSecretConfig = {
  provider: "hedra" | "elevenlabs";
  apiKey?: string;
  providerSource: MediaProviderSource;
  profileId?: string;
};

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function splitModels(value: string | undefined, fallback: string[]) {
  const models = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return models.length ? models : fallback;
}

function imageModels(provider: string, models: string[]): MediaModelInfo[] {
  return models.map((id) => ({
    id,
    name: id,
    type: "image",
    provider,
    aspectRatios: ["1:1", "4:5", "16:9", "9:16"],
    resolutions: ["1024x1024", "1024x1536", "1536x1024", "auto"],
    durations: [],
    credits: 1,
    requires: { prompt: true },
  }));
}

function audioModels(provider: string, models: string[]): MediaModelInfo[] {
  return models.map((id) => ({
    id,
    name: id,
    type: "audio",
    provider,
    aspectRatios: [],
    resolutions: [],
    durations: [],
    credits: 1,
    requires: { prompt: true, voice: true },
  }));
}

export function getMediaProviderStatus(env: NodeJS.ProcessEnv = process.env): MediaProviderStatus {
  const savedHedra = desktopMediaProvider("hedra", env);
  const savedEleven = desktopMediaProvider("elevenlabs", env);
  const savedOpenAI = desktopMediaProvider("openai", env);
  const savedXai = desktopMediaProvider("xai", env);
  const savedCustomImage = desktopMediaProvider("custom-image", env);
  const openaiModels = imageModels("openai", splitModels(env.MEDIA_OPENAI_IMAGE_MODELS, ["gpt-image-1"]));
  const openaiAudioModels = audioModels("openai", splitModels(env.MEDIA_OPENAI_AUDIO_MODELS, ["gpt-4o-mini-tts", "tts-1"]));
  const xaiModels = imageModels("xai", splitModels(env.MEDIA_XAI_IMAGE_MODELS, ["grok-2-image"]));
  const customModels = imageModels("custom-image", splitModels(env.MEDIA_IMAGE_MODELS, ["custom-image-model"]));

  const hedra: MediaProviderInfo = {
    id: "hedra",
    label: "Hedra",
    configured: hasValue(env.HEDRA_API_KEY) || hasValue(savedHedra?.apiKey),
    capabilities: ["image", "video", "avatar"],
    envVars: ["HEDRA_API_KEY"],
    models: [],
  };
  const elevenlabs: MediaProviderInfo = {
    id: "elevenlabs",
    label: "ElevenLabs",
    configured: hasValue(env.ELEVENLABS_API_KEY) || hasValue(savedEleven?.apiKey),
    capabilities: ["audio"],
    envVars: ["ELEVENLABS_API_KEY"],
    models: [{
      id: "eleven-tts-multilingual-v2",
      name: "ElevenLabs · Multilingual v2",
      type: "audio",
      provider: "elevenlabs",
      aspectRatios: [],
      resolutions: [],
      durations: [],
      credits: 1,
      requires: { prompt: true, voice: true },
    }],
  };
  const openai: MediaProviderInfo = {
    id: "openai",
    label: "OpenAI",
    configured: hasValue(env.MEDIA_OPENAI_API_KEY) || hasValue(env.OPENAI_API_KEY) || hasValue(savedOpenAI?.apiKey),
    capabilities: ["image", "audio"],
    envVars: ["MEDIA_OPENAI_API_KEY", "OPENAI_API_KEY"],
    models: [...openaiModels, ...openaiAudioModels],
  };
  const xai: MediaProviderInfo = {
    id: "xai",
    label: "xAI / Grok",
    configured: hasValue(env.MEDIA_XAI_API_KEY) || hasValue(env.XAI_API_KEY) || hasValue(savedXai?.apiKey),
    capabilities: ["image"],
    envVars: ["MEDIA_XAI_API_KEY", "XAI_API_KEY"],
    models: xaiModels,
  };
  const customImage: MediaProviderInfo = {
    id: "custom-image",
    label: "Custom image endpoint",
    configured: (hasValue(env.MEDIA_IMAGE_BASE_URL) && hasValue(env.MEDIA_IMAGE_API_KEY)) || (hasValue(savedCustomImage?.baseUrl) && hasValue(savedCustomImage?.apiKey)),
    capabilities: ["image"],
    envVars: ["MEDIA_IMAGE_BASE_URL", "MEDIA_IMAGE_API_KEY", "MEDIA_IMAGE_MODELS"],
    models: customModels,
  };

  return {
    hedra,
    elevenlabs,
    openai,
    xai,
    customImage,
    providers: [hedra, elevenlabs, openai, xai, customImage],
  };
}

function addSource(info: MediaProviderInfo, source: MediaProviderSource, profileId?: string) {
  const sources = new Set(info.sources ?? []);
  sources.add(source);
  info.sources = Array.from(sources);
  if (profileId) {
    const profileIds = new Set(info.profileIds ?? []);
    profileIds.add(profileId);
    info.profileIds = Array.from(profileIds);
  }
}

function markManagedSources(status: MediaProviderStatus) {
  for (const provider of status.providers) {
    if (provider.configured) addSource(provider, "managed");
  }
}

function mediaStatusKey(provider: string): keyof Pick<MediaProviderStatus, "hedra" | "elevenlabs" | "openai" | "xai" | "customImage"> | null {
  if (provider === "custom-image") return "customImage";
  if (provider === "hedra" || provider === "elevenlabs" || provider === "openai" || provider === "xai") return provider;
  return null;
}

function modelForProfile(profile: HostedMediaProviderProfileView): MediaModelInfo | null {
  if (!profile.model) return null;
  if (profile.provider === "elevenlabs") {
    return {
      id: profile.model,
      name: profile.model,
      type: "audio",
      provider: "elevenlabs",
      credits: 1,
      requires: { prompt: true, voice: true },
    };
  }
  if (profile.provider === "openai") {
    return {
      id: profile.model,
      name: profile.model,
      type: profile.model.includes("tts") ? "audio" : "image",
      provider: "openai",
      aspectRatios: ["1:1", "4:5", "16:9", "9:16"],
      resolutions: ["1024x1024", "1024x1536", "1536x1024", "auto"],
      credits: 1,
      requires: { prompt: true },
    };
  }
  if (profile.provider === "xai" || profile.provider === "custom-image") {
    return {
      id: profile.model,
      name: profile.model,
      type: "image",
      provider: profile.provider,
      aspectRatios: ["1:1", "4:5", "16:9", "9:16"],
      resolutions: ["1024x1024", "1024x1536", "1536x1024", "auto"],
      credits: 1,
      requires: { prompt: true },
    };
  }
  return null;
}

export async function getMediaProviderStatusForUser(
  user: Pick<SessionUser, "id" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MediaProviderStatus> {
  const status = getMediaProviderStatus(env);
  markManagedSources(status);
  if (isLocalFirstMode() || !user.workspaceId) return status;

  const settings = await getHostedMediaProviderSettings(user);
  for (const profile of settings.profiles) {
    if (!profile.hasApiKey) continue;
    const key = mediaStatusKey(profile.provider);
    if (!key) continue;
    const info = status[key];
    info.configured = true;
    addSource(info, "byok", profile.id);
    const model = modelForProfile(profile);
    if (model && !info.models.some((item) => item.id === model.id && item.type === model.type)) {
      info.models.push(model);
    }
  }
  return {
    ...status,
    providers: [status.hedra, status.elevenlabs, status.openai, status.xai, status.customImage],
  };
}

export function getImageProviderConfig(provider: string | undefined, env: NodeJS.ProcessEnv = process.env): ImageProviderConfig | null {
  if (provider === "openai") {
    const saved = desktopMediaProvider("openai", env);
    const apiKey = (env.MEDIA_OPENAI_API_KEY || env.OPENAI_API_KEY || saved?.apiKey || "").trim();
    if (!apiKey) return null;
    return { provider: "openai", apiKey, baseUrl: (env.MEDIA_OPENAI_BASE_URL || saved?.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") };
  }
  if (provider === "xai") {
    const saved = desktopMediaProvider("xai", env);
    const apiKey = (env.MEDIA_XAI_API_KEY || env.XAI_API_KEY || saved?.apiKey || "").trim();
    if (!apiKey) return null;
    return { provider: "xai", apiKey, baseUrl: (env.MEDIA_XAI_BASE_URL || saved?.baseUrl || "https://api.x.ai/v1").replace(/\/$/, "") };
  }
  if (provider === "custom-image") {
    const saved = desktopMediaProvider("custom-image", env);
    const apiKey = (env.MEDIA_IMAGE_API_KEY || saved?.apiKey || "").trim();
    const baseUrl = (env.MEDIA_IMAGE_BASE_URL || saved?.baseUrl || "").trim().replace(/\/$/, "");
    if (!apiKey || !baseUrl) return null;
    return { provider: "custom-image", apiKey, baseUrl };
  }
  return null;
}

function defaultMediaBaseUrl(provider: MediaProvider) {
  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "xai") return "https://api.x.ai/v1";
  return "";
}

function supportsImageProvider(provider: string | undefined): provider is ImageProviderConfig["provider"] {
  return provider === "openai" || provider === "xai" || provider === "custom-image";
}

export async function getImageProviderForUser(
  provider: string | undefined,
  user: Pick<SessionUser, "id" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ImageProviderConfig | null> {
  if (!supportsImageProvider(provider)) return null;
  if (!isLocalFirstMode() && user.workspaceId) {
    const saved = await getHostedMediaProviderProfileForProvider(user, provider);
    const apiKey = saved?.apiKey?.trim();
    const baseUrl = (saved?.baseUrl || defaultMediaBaseUrl(provider)).trim().replace(/\/$/, "");
    if (saved && apiKey && baseUrl) {
      return { provider, apiKey, baseUrl, providerSource: "byok", profileId: saved.id };
    }
  }
  const managed = getImageProviderConfig(provider, env);
  return managed ? { ...managed, providerSource: "managed" } : null;
}

export function getAudioProviderConfig(provider: string | undefined, env: NodeJS.ProcessEnv = process.env): AudioProviderConfig | null {
  if (provider === "openai") {
    const saved = desktopMediaProvider("openai", env);
    const apiKey = (env.MEDIA_OPENAI_API_KEY || env.OPENAI_API_KEY || saved?.apiKey || "").trim();
    if (!apiKey) return null;
    return { provider: "openai", apiKey, baseUrl: (env.MEDIA_OPENAI_BASE_URL || saved?.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") };
  }
  return null;
}

export async function getAudioProviderForUser(
  provider: string | undefined,
  user: Pick<SessionUser, "id" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AudioProviderConfig | null> {
  if (provider !== "openai") return null;
  if (!isLocalFirstMode() && user.workspaceId) {
    const saved = await getHostedMediaProviderProfileForProvider(user, "openai");
    const apiKey = saved?.apiKey?.trim();
    const baseUrl = (saved?.baseUrl || defaultMediaBaseUrl("openai")).trim().replace(/\/$/, "");
    if (saved && apiKey && baseUrl) {
      return { provider: "openai", apiKey, baseUrl, providerSource: "byok", profileId: saved.id };
    }
  }
  const managed = getAudioProviderConfig(provider, env);
  return managed ? { ...managed, providerSource: "managed" } : null;
}

async function getSecretProviderForUser(
  provider: "hedra" | "elevenlabs",
  user: Pick<SessionUser, "id" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MediaSecretConfig | null> {
  if (!isLocalFirstMode() && user.workspaceId) {
    const saved = await getHostedMediaProviderProfileForProvider(user, provider);
    const apiKey = saved?.apiKey?.trim();
    if (saved && apiKey) return { provider, apiKey, providerSource: "byok", profileId: saved.id };
  }
  const envKey = provider === "hedra" ? env.HEDRA_API_KEY : env.ELEVENLABS_API_KEY;
  const saved = desktopMediaProvider(provider, env);
  const apiKey = (envKey || saved?.apiKey || "").trim();
  return apiKey ? { provider, apiKey, providerSource: "managed" } : null;
}

export function getHedraProviderForUser(
  user: Pick<SessionUser, "id" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MediaSecretConfig | null> {
  return getSecretProviderForUser("hedra", user, env);
}

export function getElevenLabsProviderForUser(
  user: Pick<SessionUser, "id" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MediaSecretConfig | null> {
  return getSecretProviderForUser("elevenlabs", user, env);
}
