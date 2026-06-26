import { desktopMediaProvider } from "@/lib/desktopSettings";
import type { SessionUser } from "@/lib/auth";
import { normalizeHostedProviderBaseUrl } from "@/lib/hostedProviderUrls";
import { isLocalFirstMode } from "@/lib/local/mode";
import {
  getHostedMediaProviderProfile,
  getHostedMediaProviderProfileForProvider,
  getHostedMediaProviderSettings,
  type HostedMediaProviderProfileSecret,
  type HostedMediaProviderProfileView,
  type MediaProvider,
} from "@/lib/mediaProviderSettings";
import {
  getHostedProviderProfile,
  getHostedProviderProfileForProvider,
  getHostedProviderSettings,
  type HostedProviderProfileSecret,
  type HostedProviderProfileView,
} from "@/lib/providerSettings";

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
  profileId?: string;
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
  setup: {
    keyLabel: string;
    summary: string;
    helpUrl: string;
    defaultModel?: string;
    defaultBaseUrl?: string;
    modelPlaceholder: string;
  };
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
  const openaiModels = imageModels("openai", splitModels(env.MEDIA_OPENAI_IMAGE_MODELS, ["gpt-image-1.5", "gpt-image-1-mini"]));
  const openaiAudioModels = audioModels("openai", splitModels(env.MEDIA_OPENAI_AUDIO_MODELS, ["gpt-4o-mini-tts", "tts-1"]));
  const xaiModels = imageModels("xai", splitModels(env.MEDIA_XAI_IMAGE_MODELS, ["grok-imagine-image-quality"]));
  const customModels = imageModels("custom-image", splitModels(env.MEDIA_IMAGE_MODELS, ["custom-image-model"]));

  const hedra: MediaProviderInfo = {
    id: "hedra",
    label: "Hedra",
    configured: hasValue(env.HEDRA_API_KEY) || hasValue(savedHedra?.apiKey),
    capabilities: ["image", "video", "avatar"],
    envVars: ["HEDRA_API_KEY"],
    models: [],
    setup: {
      keyLabel: "Hedra API key",
      summary: "Use Hedra for image, video, and avatar generation in Studio.",
      helpUrl: "https://www.hedra.com/",
      modelPlaceholder: "Selected from Hedra models at generation time",
    },
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
    setup: {
      keyLabel: "ElevenLabs API key",
      summary: "Use ElevenLabs for polished text-to-speech and voiceover drafts.",
      helpUrl: "https://elevenlabs.io/app/settings/api-keys",
      defaultModel: "eleven-tts-multilingual-v2",
      modelPlaceholder: "eleven-tts-multilingual-v2",
    },
  };
  const openai: MediaProviderInfo = {
    id: "openai",
    label: "OpenAI",
    configured: hasValue(env.MEDIA_OPENAI_API_KEY) || hasValue(env.OPENAI_API_KEY) || hasValue(savedOpenAI?.apiKey),
    capabilities: ["image", "audio"],
    envVars: ["MEDIA_OPENAI_API_KEY", "OPENAI_API_KEY"],
    models: [...openaiModels, ...openaiAudioModels],
    setup: {
      keyLabel: "OpenAI API key",
      summary: "Use OpenAI for image generation and built-in read-aloud audio.",
      helpUrl: "https://platform.openai.com/api-keys",
      defaultModel: openaiModels[0]?.id ?? "gpt-image-1.5",
      defaultBaseUrl: "https://api.openai.com/v1",
      modelPlaceholder: "gpt-image-1.5, gpt-image-1-mini, or gpt-4o-mini-tts",
    },
  };
  const xai: MediaProviderInfo = {
    id: "xai",
    label: "xAI / Grok",
    configured: hasValue(env.MEDIA_XAI_API_KEY) || hasValue(env.XAI_API_KEY) || hasValue(savedXai?.apiKey),
    capabilities: ["image"],
    envVars: ["MEDIA_XAI_API_KEY", "XAI_API_KEY"],
    models: xaiModels,
    setup: {
      keyLabel: "xAI API key",
      summary: "Use xAI/Grok for OpenAI-compatible image generation.",
      helpUrl: "https://console.x.ai/",
      defaultModel: xaiModels[0]?.id ?? "grok-imagine-image-quality",
      defaultBaseUrl: "https://api.x.ai/v1",
      modelPlaceholder: "grok-imagine-image-quality",
    },
  };
  const customImage: MediaProviderInfo = {
    id: "custom-image",
    label: "Custom image endpoint",
    configured: (hasValue(env.MEDIA_IMAGE_BASE_URL) && hasValue(env.MEDIA_IMAGE_API_KEY)) || (hasValue(savedCustomImage?.baseUrl) && hasValue(savedCustomImage?.apiKey)),
    capabilities: ["image"],
    envVars: ["MEDIA_IMAGE_BASE_URL", "MEDIA_IMAGE_API_KEY", "MEDIA_IMAGE_MODELS"],
    models: customModels,
    setup: {
      keyLabel: "Custom image API key",
      summary: "Use any OpenAI-compatible image endpoint by adding its base URL.",
      helpUrl: "https://platform.openai.com/docs/api-reference/images",
      defaultModel: customModels[0]?.id ?? "custom-image-model",
      defaultBaseUrl: "",
      modelPlaceholder: "Provider model name",
    },
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
      profileId: profile.id,
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
      profileId: profile.id,
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
      profileId: profile.id,
      aspectRatios: ["1:1", "4:5", "16:9", "9:16"],
      resolutions: ["1024x1024", "1024x1536", "1536x1024", "auto"],
      credits: 1,
      requires: { prompt: true },
    };
  }
  return null;
}

function mediaProviderFromLlmProfile(
  profile: Pick<HostedProviderProfileView, "provider"> | null | undefined,
): "openai" | "xai" | null {
  if (!profile) return null;
  if (profile.provider === "openai") return "openai";
  if (profile.provider === "xai") return "xai";
  return null;
}

function addLlmProfileMediaModels(info: MediaProviderInfo, profile: HostedProviderProfileView) {
  const mediaProvider = mediaProviderFromLlmProfile(profile);
  if (!mediaProvider) return;
  const modelIds = info.models.map((model) => `${model.type}:${model.id}`);
  const defaults = mediaProvider === "openai"
    ? ["gpt-image-1.5", "gpt-image-1-mini", "gpt-4o-mini-tts"]
    : ["grok-imagine-image-quality"];
  for (const id of defaults) {
    const type: MediaCapability = id.includes("tts") ? "audio" : "image";
    if (modelIds.includes(`${type}:${id}`)) {
      const existing = info.models.find((model) => model.id === id && model.type === type);
      if (existing && !existing.profileId) existing.profileId = profile.id;
      continue;
    }
    info.models.push({
      id,
      name: id,
      type,
      provider: mediaProvider,
      profileId: profile.id,
      aspectRatios: type === "image" ? ["1:1", "4:5", "16:9", "9:16"] : [],
      resolutions: type === "image" ? ["1024x1024", "1024x1536", "1536x1024", "auto"] : [],
      durations: [],
      credits: 1,
      requires: type === "audio" ? { prompt: true, voice: true } : { prompt: true },
    });
  }
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
  const llmSettings = await getHostedProviderSettings(user);
  for (const profile of llmSettings.profiles) {
    if (!profile.hasApiKey) continue;
    const mediaProvider = mediaProviderFromLlmProfile(profile);
    if (!mediaProvider) continue;
    const key = mediaStatusKey(mediaProvider);
    if (!key) continue;
    const info = status[key];
    info.configured = true;
    addSource(info, "byok", profile.id);
    addLlmProfileMediaModels(info, profile);
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

async function hostedMediaProfileById(
  user: Pick<SessionUser, "id" | "workspaceId">,
  profileId: string | undefined | null,
): Promise<HostedMediaProviderProfileSecret | null> {
  if (isLocalFirstMode() || !user.workspaceId || !profileId) return null;
  return getHostedMediaProviderProfile(user, profileId);
}

async function hostedLlmMediaProfileById(
  user: Pick<SessionUser, "id" | "workspaceId">,
  profileId: string | undefined | null,
): Promise<HostedProviderProfileSecret | null> {
  if (isLocalFirstMode() || !user.workspaceId || !profileId) return null;
  const profile = await getHostedProviderProfile(user, profileId);
  return profile && mediaProviderFromLlmProfile(profile) ? profile : null;
}

async function hostedLlmMediaProfileForProvider(
  user: Pick<SessionUser, "id" | "workspaceId">,
  provider: "openai" | "xai",
): Promise<HostedProviderProfileSecret | null> {
  if (isLocalFirstMode() || !user.workspaceId) return null;
  return getHostedProviderProfileForProvider(user, provider);
}

export async function getImageProviderForUser(
  provider: string | undefined,
  user: Pick<SessionUser, "id" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
  profileId?: string,
): Promise<ImageProviderConfig | null> {
  const exact = await hostedMediaProfileById(user, profileId);
  const exactLlm = exact ? null : await hostedLlmMediaProfileById(user, profileId);
  const selectedProvider = exact?.provider ?? mediaProviderFromLlmProfile(exactLlm) ?? provider;
  if (!supportsImageProvider(selectedProvider)) return null;
  if (exact) {
    const apiKey = exact.apiKey?.trim();
    const baseUrl = normalizeHostedProviderBaseUrl(exact.baseUrl || defaultMediaBaseUrl(selectedProvider));
    if (apiKey && baseUrl) {
      return { provider: selectedProvider, apiKey, baseUrl, providerSource: "byok", profileId: exact.id };
    }
    return null;
  }
  if (exactLlm) {
    const mediaProvider = mediaProviderFromLlmProfile(exactLlm);
    const apiKey = exactLlm.apiKey?.trim();
    const baseUrl = normalizeHostedProviderBaseUrl(exactLlm.baseUrl || (mediaProvider ? defaultMediaBaseUrl(mediaProvider) : ""));
    if (mediaProvider && supportsImageProvider(mediaProvider) && apiKey && baseUrl) {
      return { provider: mediaProvider, apiKey, baseUrl, providerSource: "byok", profileId: exactLlm.id };
    }
    return null;
  }
  if (!isLocalFirstMode() && user.workspaceId) {
    const saved = await getHostedMediaProviderProfileForProvider(user, selectedProvider);
    const apiKey = saved?.apiKey?.trim();
    const baseUrl = normalizeHostedProviderBaseUrl(saved?.baseUrl || defaultMediaBaseUrl(selectedProvider));
    if (saved && apiKey && baseUrl) {
      return { provider: selectedProvider, apiKey, baseUrl, providerSource: "byok", profileId: saved.id };
    }
    const llmSaved = selectedProvider === "openai" || selectedProvider === "xai"
      ? await hostedLlmMediaProfileForProvider(user, selectedProvider)
      : null;
    const llmApiKey = llmSaved?.apiKey?.trim();
    const llmBaseUrl = normalizeHostedProviderBaseUrl(llmSaved?.baseUrl || defaultMediaBaseUrl(selectedProvider));
    if (llmSaved && llmApiKey && llmBaseUrl) {
      return { provider: selectedProvider, apiKey: llmApiKey, baseUrl: llmBaseUrl, providerSource: "byok", profileId: llmSaved.id };
    }
  }
  const managed = getImageProviderConfig(selectedProvider, env);
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
  profileId?: string,
): Promise<AudioProviderConfig | null> {
  const exact = await hostedMediaProfileById(user, profileId);
  const exactLlm = exact ? null : await hostedLlmMediaProfileById(user, profileId);
  const selectedProvider = exact?.provider ?? mediaProviderFromLlmProfile(exactLlm) ?? provider;
  if (selectedProvider !== "openai") return null;
  if (exact) {
    const apiKey = exact.apiKey?.trim();
    const baseUrl = normalizeHostedProviderBaseUrl(exact.baseUrl || defaultMediaBaseUrl("openai"));
    if (apiKey && baseUrl) {
      return { provider: "openai", apiKey, baseUrl, providerSource: "byok", profileId: exact.id };
    }
    return null;
  }
  if (exactLlm) {
    const apiKey = exactLlm.apiKey?.trim();
    const baseUrl = normalizeHostedProviderBaseUrl(exactLlm.baseUrl || defaultMediaBaseUrl("openai"));
    if (apiKey && baseUrl) {
      return { provider: "openai", apiKey, baseUrl, providerSource: "byok", profileId: exactLlm.id };
    }
    return null;
  }
  if (!isLocalFirstMode() && user.workspaceId) {
    const saved = await getHostedMediaProviderProfileForProvider(user, "openai");
    const apiKey = saved?.apiKey?.trim();
    const baseUrl = normalizeHostedProviderBaseUrl(saved?.baseUrl || defaultMediaBaseUrl("openai"));
    if (saved && apiKey && baseUrl) {
      return { provider: "openai", apiKey, baseUrl, providerSource: "byok", profileId: saved.id };
    }
    const llmSaved = await hostedLlmMediaProfileForProvider(user, "openai");
    const llmApiKey = llmSaved?.apiKey?.trim();
    const llmBaseUrl = normalizeHostedProviderBaseUrl(llmSaved?.baseUrl || defaultMediaBaseUrl("openai"));
    if (llmSaved && llmApiKey && llmBaseUrl) {
      return { provider: "openai", apiKey: llmApiKey, baseUrl: llmBaseUrl, providerSource: "byok", profileId: llmSaved.id };
    }
  }
  const managed = getAudioProviderConfig(provider, env);
  return managed ? { ...managed, providerSource: "managed" } : null;
}

async function getSecretProviderForUser(
  provider: "hedra" | "elevenlabs",
  user: Pick<SessionUser, "id" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
  profileId?: string,
): Promise<MediaSecretConfig | null> {
  const exact = await hostedMediaProfileById(user, profileId);
  if (exact) {
    if (exact.provider !== provider) return null;
    const apiKey = exact.apiKey?.trim();
    return apiKey ? { provider, apiKey, providerSource: "byok", profileId: exact.id } : null;
  }
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
  profileId?: string,
): Promise<MediaSecretConfig | null> {
  return getSecretProviderForUser("hedra", user, env, profileId);
}

export function getElevenLabsProviderForUser(
  user: Pick<SessionUser, "id" | "workspaceId">,
  env: NodeJS.ProcessEnv = process.env,
  profileId?: string,
): Promise<MediaSecretConfig | null> {
  return getSecretProviderForUser("elevenlabs", user, env, profileId);
}
