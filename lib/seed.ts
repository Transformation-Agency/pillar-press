/**
 * Seed data for Pillar Press campaigns + references.
 *
 * SEED_REFERENCES and CAMPAIGN_NAMES are ported VERBATIM from
 * prototype-reference/store.js (the source of truth for the references doc
 * shape and the 11 default campaign names). seedWorkspace inserts the 11
 * campaigns (slug = kebab-case of name) each with a references row whose
 * doc = SEED_REFERENCES.
 */
import type { db as Db } from "@/lib/db";
import { campaigns, references } from "@/lib/db";

/* ---- Seed reference documents (representative placeholders) ----
   VERBATIM copy of SEED_REFERENCES from prototype-reference/store.js */
export const SEED_REFERENCES = {
  strategy: {
    title: "Content Strategy",
    throughlines: [
      { tag: "human-in-the-loop", name: "The Human in the Loop", note: "AI extends human judgment; it does not replace the author. Agency stays with people." },
      { tag: "relational-tech", name: "Relational Technology", note: "Tools are worth building only if they deepen relationships and trust between people." },
      { tag: "quiet-competence", name: "Quiet Competence", note: "Mastery shown, not announced. Show the work; skip the triumphalism." },
      { tag: "coordination", name: "Coordination & Governance", note: "How groups decide, align, and keep promises at scale." },
    ],
    body: "Every piece must serve at least one throughline. If it doesn't, name the nearest strategic angle and the smallest pivot that would land it there. We never recommend killing a piece — only redirecting it."
  },
  audiences: {
    title: "Defined Audiences",
    list: [
      { id: "leaders", name: "Leaders in personal spheres", note: "People who shape a community, team, or family. Care about responsibility and example." },
      { id: "builders", name: "Builders & founders", note: "Shipping things. Want leverage, honesty about tradeoffs, and no hype." },
      { id: "women-ai", name: "Women curious about AI", note: "Smart, skeptical, underserved by hype-cycle coverage. Want a grounded on-ramp." },
      { id: "governance", name: "Governance & coordination thinkers", note: "Mechanism-minded. Care about incentives, institutions, and failure modes." },
      { id: "relational", name: "Existing relational audience", note: "People who already know and trust the author. Speak as a continuing conversation." },
      { id: "general", name: "General public bridge", note: "No prior context. Need the stakes made plain without condescension." },
    ]
  },
  registers: {
    title: "Voice — Two Registers",
    list: [
      { id: "essay", name: "Essay register", note: "Measured, literary, first-person, comfortable with a long sentence and a turn. For Substack and reflective long-form. Earns its claims slowly." },
      { id: "field", name: "Field register", note: "Direct, plain, second-person-friendly, short sentences. For relational platforms and practical posts. Warm, not breezy." },
    ],
    body: "Detect which register a piece is in. Flag register mixing (an essay sentence dropped into a field post, or vice versa) and voice drift (sentences that sound generic-LinkedIn, not like the author)."
  },
  voiceRules: {
    title: "Clarity & Communication Rules",
    rules: [
      "The central claim appears in the first two lines.",
      "Each paragraph does exactly one job.",
      "Actors and actions are visible — name who does what; avoid hidden subjects and nominalizations.",
      "Every term is either defined on first use or cut.",
      "Every number carries its meaning — no naked statistics.",
      "Prefer the concrete noun to the abstract category.",
      "A line that sounds like the author always beats a tidier generic line.",
    ]
  },
  redLines: {
    title: "Red Lines & Boundaries",
    rules: [
      "No claims of certainty about others' internal states or motives.",
      "No dunking, no contempt, no quote-tweet hostility — disagree with the strongest version.",
      "No private details about named real people without consent.",
      "No fear-based AI doom framing as a hook; stakes stated soberly.",
      "No selling in the first beat of a relational post; offerings come last and optional.",
      "Never overclaim empirical results; testimony is fine as testimony.",
    ]
  },
  selfVision: {
    title: "Self-Vision — Public Identity",
    body: "The author is a builder who writes: technically fluent but not a hype-man, warm but exacting, more interested in good questions than hot takes. Optimistic about technology in service of human relationship and judgment. Reads as a person thinking in public, not a brand performing authority. Self-alignment gate flags anything that contradicts this — false bravado, manufactured outrage, borrowed jargon, or certainty the author wouldn't actually claim."
  },
  gateSpec: {
    title: "Gate Specification",
    body: "Seven gates run in order. Each emits a section of the Review Packet. Findings carry one of three severities — Must-fix, Consider, Note — grouped by gate and ordered by severity within each gate. The Proposed Revision applies ONLY clarity, tone, and inoculation findings; strategy, audience, rigor, and identity findings remain in the report for the author to judge. Where a clarity rule would flatten a line that sounds like the author, the author's line wins."
  }
} as const;

export type SeedReferences = typeof SEED_REFERENCES;

/* The 11 default campaign names — VERBATIM from store.js CAMPAIGN_NAMES */
export const CAMPAIGN_NAMES = [
  "Me",
  "Anna",
  "Diana",
  "Liana",
  "Max",
  "Transformation Agency",
  "Metacanon AI",
  "Lumenus Inc",
  "Jedi Sherpa",
  "Wizard Joe",
  "Feral Pharaoh",
] as const;

/** kebab-case a campaign name into a slug. Ported from store.js `slug`. */
export function slug(n: string): string {
  return n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Insert the 11 seed campaigns into a workspace, each with a references row
 * whose doc = SEED_REFERENCES. Returns the inserted campaign rows.
 */
export async function seedWorkspace(database: typeof Db, workspaceId: string) {
  const campaignRows = await database
    .insert(campaigns)
    .values(
      CAMPAIGN_NAMES.map((name) => ({
        workspaceId,
        slug: slug(name),
        name,
      })),
    )
    .returning();

  if (campaignRows.length) {
    await database.insert(references).values(
      campaignRows.map((c) => ({
        campaignId: c.id,
        // fresh clone of the seed doc per campaign
        doc: JSON.parse(JSON.stringify(SEED_REFERENCES)) as SeedReferences,
      })),
    );
  }

  return campaignRows;
}
