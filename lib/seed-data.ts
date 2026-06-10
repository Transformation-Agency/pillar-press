/**
 * Minimal starter data for King’s Press.
 *
 * The desktop app should open lean: no preloaded campaign list and no bulky
 * author-specific reference document. A user-created campaign gets this blank
 * references skeleton so editors can fill in their own strategy, audiences, and
 * voice rules.
 */

export const EMPTY_REFERENCES = {
  strategy: { throughlines: [], body: "" },
  audiences: { list: [] },
  registers: { list: [], body: "" },
  voiceRules: { rules: [] },
  redLines: { rules: [] },
  selfVision: { body: "" },
  gateSpec: { body: "" },
} as const;

/** @deprecated Use EMPTY_REFERENCES. Retained for older imports during migration. */
export const SEED_REFERENCES = EMPTY_REFERENCES;
export type SeedReferences = typeof EMPTY_REFERENCES;

export const CAMPAIGN_NAMES = [] as const;

export function slug(n: string): string {
  return n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
