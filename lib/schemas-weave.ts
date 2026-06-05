/**
 * Zod schemas for the Weave route (Unit U3.4).
 *
 * Unit-local per the build conventions (NOT the shared lib/validation.ts).
 * Mirrors the prototype runWeave() input: an array of { name, text } sources.
 */
import { z } from "zod";

const weaveSourceSchema = z.object({
  name: z.string().trim().min(1, "Each source needs a name.").max(300),
  text: z.string().max(200_000),
});

/**
 * POST /api/weave — { sources, campaignId? }.
 *
 * `sources`: the documents to weave. runWeave() itself requires at least two
 * usable sources (text > 20 chars after trim); we keep a permissive min(2) here
 * so the route surfaces the same intent as a 400 rather than a 500.
 *
 * `campaignId` (optional): when present and in the caller's workspace, its
 * references doc is serialized into the prompt context (buildRefContext). When
 * absent, the weave runs with an empty reference context (still valid — the
 * prototype guards every reference block).
 */
export const weaveBodySchema = z.object({
  sources: z.array(weaveSourceSchema).min(2, "Add at least two sources with content to weave."),
  campaignId: z.string().uuid().optional(),
});
export type WeaveBodyInput = z.infer<typeof weaveBodySchema>;
