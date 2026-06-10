/** Zod request schemas + file-validation helpers for the Hedra/Eleven routes. */
import { z } from "zod";

export const generationTypeSchema = z.enum(["image", "video", "avatar_video", "audio"]);

export const generateBodySchema = z.object({
  type: generationTypeSchema,
  modelId: z.string().min(1),
  provider: z.string().trim().optional(),
  // prompt required for image/video/audio; optional for avatar (visual scene)
  prompt: z.string().trim().min(3, "Prompt must be at least 3 characters.").max(2000, "Prompt is too long (max 2000).").optional(),
  // voiceover / TTS — long scripts are chunked + stitched server-side
  script: z.string().trim().max(100000).optional(),
  voiceId: z.string().optional(),
  // combine: an existing audio media to use as the video's audio track
  audioMediaId: z.string().uuid().optional(),
  // frames + audio refs (asset ids that belong to this user)
  startAssetId: z.string().optional(),
  endAssetId: z.string().optional(),
  audioAssetId: z.string().optional(),
  // model params (validated again against model metadata server-side)
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  duration: z.number().int().positive().max(600).optional(),
  // link to a King's Press content item
  pieceId: z.string().optional(),
  // campaign scope (drives per-campaign style profile + media scoping)
  campaignId: z.string().optional(),
  // image only: art-direct the prompt before generating (default true)
  enhance: z.boolean().optional(),
  // true when `prompt` is an already art-directed prompt sent verbatim (skip
  // both enhancement and the style-directive prepend).
  directed: z.boolean().optional(),
});
export type GenerateBody = z.infer<typeof generateBodySchema>;

export const ttsBodySchema = z.object({
  text: z.string().trim().min(1).max(5000),
  voiceId: z.string().min(1),
  modelId: z.string().optional(),
});

export const listModelsQuerySchema = z.object({
  type: z.string().optional(), // comma-separated
});

// ---- upload validation ----
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/mp4", "audio/x-m4a"];

export function validateUpload(file: { type: string; size: number }, kind: "image" | "audio"): string | null {
  const allowed = kind === "image" ? IMAGE_TYPES : AUDIO_TYPES;
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (!allowed.includes(file.type)) return `Unsupported ${kind} type. Allowed: ${allowed.join(", ")}.`;
  if (file.size > max) return `File too large. Max ${(max / 1024 / 1024) | 0}MB.`;
  return null;
}

/** Validate a generate request against the selected model's capability metadata. */
export function validateAgainstModel(
  body: GenerateBody,
  model: { aspect_ratios?: string[]; resolutions?: string[]; durations?: number[]; max_duration?: number; requires_start_frame?: boolean; requires_end_frame?: boolean; requires_audio?: boolean },
): string | null {
  if (model.requires_start_frame && !body.startAssetId) return "This model requires a start image.";
  if (model.requires_end_frame && !body.endAssetId) return "This model requires an end image.";
  if (model.requires_audio && !body.audioAssetId) return "This model requires an audio track.";
  if (body.aspectRatio && model.aspect_ratios?.length && !model.aspect_ratios.includes(body.aspectRatio)) return "Unsupported aspect ratio for this model.";
  if (body.resolution && model.resolutions?.length && !model.resolutions.includes(body.resolution)) return "Unsupported resolution for this model.";
  if (body.duration && model.max_duration && body.duration > model.max_duration) return `Max duration is ${model.max_duration}s.`;
  return null;
}

/** Strip control chars / trim for safe display + storage. */
export function sanitizeText(s: string | undefined, max = 2000): string {
  return (s ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}
