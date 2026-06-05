/**
 * Zod schemas for the per-user/workspace settings route (U2.3).
 *
 * The settings row holds a Drive *folder id* and a bag of non-secret UI
 * preferences (theme, active campaign, tweaks, ...). It does NOT hold any
 * provider API keys or the Drive refresh token — those are server-only secrets
 * and are never read or written through this endpoint.
 */
import { z } from "zod";

/**
 * Non-secret UI prefs. Open-ended (the prototype stores theme / activeCampaignId
 * / tweaks), so we accept an arbitrary JSON object but pin the well-known keys
 * for light validation. Unknown keys pass through unchanged.
 */
export const prefsSchema = z
  .object({
    theme: z.enum(["light", "dark"]).optional(),
    activeCampaignId: z.string().optional(),
  })
  .catchall(z.unknown());

/**
 * PUT body. Both fields optional so callers can patch one without clobbering the
 * other. `driveFolderId: null` explicitly clears the folder. Provider secrets
 * are intentionally absent from this schema.
 */
export const updateSettingsSchema = z
  .object({
    driveFolderId: z.string().max(512).nullable().optional(),
    prefs: prefsSchema.optional(),
  })
  .strict();

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type Prefs = z.infer<typeof prefsSchema>;

/**
 * Shape returned to the client. NEVER includes driveRefreshToken (secret).
 */
export interface SettingsView {
  id: string;
  driveFolderId: string | null;
  prefs: Prefs;
  driveLinked: boolean;
  createdAt: Date;
  updatedAt: Date;
}
