import { uploadPublicFile, persistRemoteImage } from "@/lib/storage";
import type { ImageProviderConfig } from "@/lib/mediaProviders";
import type { SessionUser } from "@/lib/auth";

type ImageGenerationResult = {
  outputUrl: string;
  downloadUrl: string;
  providerResponseId?: string | null;
};

function sizeForAspect(aspectRatio: string | undefined, resolution: string | undefined) {
  if (resolution && resolution !== "auto" && /^\d+x\d+$/.test(resolution)) return resolution;
  if (aspectRatio === "9:16" || aspectRatio === "4:5") return "1024x1536";
  if (aspectRatio === "16:9") return "1536x1024";
  return "1024x1024";
}

function xaiResolution(resolution: string | undefined) {
  if (resolution === "2k") return "2k";
  return "1k";
}

function xaiAspectRatio(aspectRatio: string | undefined) {
  if (["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "auto"].includes(aspectRatio || "")) {
    return aspectRatio;
  }
  if (aspectRatio === "4:5") return "3:4";
  return "1:1";
}

export async function generateOpenAICompatibleImage(input: {
  config: ImageProviderConfig;
  model: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  user?: SessionUser | null;
}): Promise<ImageGenerationResult> {
  const body = input.config.provider === "xai"
    ? {
        model: input.model,
        prompt: input.prompt,
        n: 1,
        aspect_ratio: xaiAspectRatio(input.aspectRatio),
        resolution: xaiResolution(input.resolution),
      }
    : {
        model: input.model,
        prompt: input.prompt,
        n: 1,
        size: sizeForAspect(input.aspectRatio, input.resolution),
      };

  const res = await fetch(`${input.config.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Image provider request failed (${res.status}).`);
  }

  const json = JSON.parse(text || "{}") as {
    id?: string;
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };
  const first = json.data?.[0];
  if (!first) throw new Error("Image provider returned no image.");

  if (first.b64_json) {
    const bytes = Buffer.from(first.b64_json, "base64");
    const outputUrl = await uploadPublicFile(bytes, `image-${Date.now()}.png`, "image/png", "image", { user: input.user });
    return { outputUrl, downloadUrl: outputUrl, providerResponseId: json.id ?? null };
  }

  if (first.url) {
    const stored = await persistRemoteImage(first.url, `image-${Date.now()}`, { user: input.user });
    const outputUrl = stored || first.url;
    return { outputUrl, downloadUrl: outputUrl, providerResponseId: json.id ?? null };
  }

  throw new Error("Image provider response did not include a URL or base64 image.");
}
