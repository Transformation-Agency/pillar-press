/** Fallback model catalog used when Hedra listModels() is unavailable, so the
 *  UI still renders. Shapes match HedraModel. Do NOT hardcode a single model in
 *  app logic — always prefer the live list and filter by type/capability. */
import type { HedraModel } from "./hedra";

export const FALLBACK_MODELS: HedraModel[] = [
  {
    id: "fallback-image", name: "Image (fallback)", type: "image",
    description: "Text-to-image. Replace with a live Hedra image model.",
    aspect_ratios: ["1:1", "4:5", "16:9", "9:16"], resolutions: ["720p", "1080p"], credits: 6,
  },
  {
    id: "fallback-i2v", name: "Image→Video (fallback)", type: "video",
    description: "Animate a start image. Replace with a live Hedra video model.",
    aspect_ratios: ["16:9", "9:16", "1:1"], resolutions: ["540p", "720p", "1080p"],
    durations: [3, 5, 8, 10], max_duration: 30, requires_start_frame: true, credits: 40,
  },
  {
    id: "fallback-avatar", name: "Avatar (fallback)", type: "video",
    description: "Talking-head video from image + audio. Replace with a live Hedra character model.",
    aspect_ratios: ["9:16", "1:1", "16:9"], resolutions: ["540p", "720p"],
    max_duration: 120, requires_start_frame: true, requires_audio: true, credits: 60,
  },
];
