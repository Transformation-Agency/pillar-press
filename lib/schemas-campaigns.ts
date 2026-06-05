/**
 * Zod schemas for the Campaigns + References routes (UNIT U2.1).
 *
 * Kept in this unit's own lib file (NOT the shared lib/validation.ts).
 */
import { z } from "zod";

/** POST /api/campaigns — create a campaign. */
export const createCampaignSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required.").max(120),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/** PATCH /api/campaigns/:id — rename a campaign. */
export const renameCampaignSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
});
export type RenameCampaignInput = z.infer<typeof renameCampaignSchema>;

/**
 * PUT /api/campaigns/:id/references — replace or patch the references doc.
 *
 * Mirrors the prototype's two reference mutations (store.js):
 *   - updateReferences(patch)        → shallow-merge a partial doc
 *   - setReferenceSection(key,value) → set one top-level section
 * Here we accept EITHER:
 *   { doc }            → full replace of the references document, or
 *   { patch }          → shallow merge into the existing document.
 * At least one must be present.
 */
export const putReferencesSchema = z
  .object({
    doc: z.record(z.string(), z.unknown()).optional(),
    patch: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.doc !== undefined || v.patch !== undefined, {
    message: "Provide either `doc` (replace) or `patch` (merge).",
  });
export type PutReferencesInput = z.infer<typeof putReferencesSchema>;
