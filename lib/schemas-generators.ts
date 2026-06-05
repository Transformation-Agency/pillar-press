/**
 * Zod schemas for the Platform Generators route (Unit U3.3).
 *
 * Kept in this unit-local file (NOT the shared lib/validation.ts) per the build
 * conventions. Mirrors the body the prototype passes into generateOutputs:
 *   { active: string[], audiences: { [platform]: audienceId } }.
 */
import { z } from "zod";
import { PLATFORMS, AUDIENCE_PRESETS } from "@/lib/generators";

const platformIds = PLATFORMS.map((p) => p.id) as [string, ...string[]];
const audienceIds = AUDIENCE_PRESETS.map((a) => a.id) as [string, ...string[]];

/** POST /api/pieces/:id/outputs */
export const outputsBodySchema = z.object({
  // Which platforms to generate. At least one; must be known platform ids.
  active: z.array(z.enum(platformIds)).min(1, "Select at least one platform."),
  // Per-platform audience selection. Keys are platform ids, values audience ids.
  // Optional / partial — generatePlatform falls back to the first preset.
  audiences: z.record(z.enum(platformIds), z.enum(audienceIds)).default({}),
});
export type OutputsBody = z.infer<typeof outputsBodySchema>;
