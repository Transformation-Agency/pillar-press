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
  capabilities: MediaCapability[];
  envVars: string[];
  models: MediaModelInfo[];
};

export type ImageProviderConfig = {
  provider: "openai" | "xai" | "custom-image";
  baseUrl: string;
  apiKey: string;
};

export type AudioProviderConfig = {
  provider: "openai";
  baseUrl: string;
  apiKey: string;
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
  const openaiModels = imageModels("openai", splitModels(env.MEDIA_OPENAI_IMAGE_MODELS, ["gpt-image-1"]));
  const openaiAudioModels = audioModels("openai", splitModels(env.MEDIA_OPENAI_AUDIO_MODELS, ["gpt-4o-mini-tts", "tts-1"]));
  const xaiModels = imageModels("xai", splitModels(env.MEDIA_XAI_IMAGE_MODELS, ["grok-2-image"]));
  const customModels = imageModels("custom-image", splitModels(env.MEDIA_IMAGE_MODELS, ["custom-image-model"]));

  const hedra: MediaProviderInfo = {
    id: "hedra",
    label: "Hedra",
    configured: hasValue(env.HEDRA_API_KEY),
    capabilities: ["image", "video", "avatar"],
    envVars: ["HEDRA_API_KEY"],
    models: [],
  };
  const elevenlabs: MediaProviderInfo = {
    id: "elevenlabs",
    label: "ElevenLabs",
    configured: hasValue(env.ELEVENLABS_API_KEY),
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
    configured: hasValue(env.MEDIA_OPENAI_API_KEY) || hasValue(env.OPENAI_API_KEY),
    capabilities: ["image", "audio"],
    envVars: ["MEDIA_OPENAI_API_KEY", "OPENAI_API_KEY"],
    models: [...openaiModels, ...openaiAudioModels],
  };
  const xai: MediaProviderInfo = {
    id: "xai",
    label: "xAI / Grok",
    configured: hasValue(env.MEDIA_XAI_API_KEY) || hasValue(env.XAI_API_KEY),
    capabilities: ["image"],
    envVars: ["MEDIA_XAI_API_KEY", "XAI_API_KEY"],
    models: xaiModels,
  };
  const customImage: MediaProviderInfo = {
    id: "custom-image",
    label: "Custom image endpoint",
    configured: hasValue(env.MEDIA_IMAGE_BASE_URL) && hasValue(env.MEDIA_IMAGE_API_KEY),
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

export function getImageProviderConfig(provider: string | undefined, env: NodeJS.ProcessEnv = process.env): ImageProviderConfig | null {
  if (provider === "openai") {
    const apiKey = (env.MEDIA_OPENAI_API_KEY || env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return null;
    return { provider: "openai", apiKey, baseUrl: (env.MEDIA_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "") };
  }
  if (provider === "xai") {
    const apiKey = (env.MEDIA_XAI_API_KEY || env.XAI_API_KEY || "").trim();
    if (!apiKey) return null;
    return { provider: "xai", apiKey, baseUrl: (env.MEDIA_XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, "") };
  }
  if (provider === "custom-image") {
    const apiKey = (env.MEDIA_IMAGE_API_KEY || "").trim();
    const baseUrl = (env.MEDIA_IMAGE_BASE_URL || "").trim().replace(/\/$/, "");
    if (!apiKey || !baseUrl) return null;
    return { provider: "custom-image", apiKey, baseUrl };
  }
  return null;
}

export function getAudioProviderConfig(provider: string | undefined, env: NodeJS.ProcessEnv = process.env): AudioProviderConfig | null {
  if (provider === "openai") {
    const apiKey = (env.MEDIA_OPENAI_API_KEY || env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return null;
    return { provider: "openai", apiKey, baseUrl: (env.MEDIA_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "") };
  }
  return null;
}
