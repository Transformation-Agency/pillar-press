import { describe, expect, it } from "vitest";
import { buildRefContext } from "@/lib/refContext";
import { SEED_REFERENCES } from "@/lib/seed";

/**
 * Golden-string assertion for buildRefContext().
 *
 * The expected string below is the BYTE-IDENTICAL output that
 * prototype-reference/ai.js#refContext() produces for SEED_REFERENCES.
 * It is written out as an independent literal (NOT derived from the function
 * under test) so that ANY drift in the port — reordered blocks, changed
 * prefixes/punctuation, lost "\n" separators — fails this test.
 */
const GOLDEN = [
  "THROUGHLINES:",
  "- [human-in-the-loop] The Human in the Loop: AI extends human judgment; it does not replace the author. Agency stays with people.",
  "- [relational-tech] Relational Technology: Tools are worth building only if they deepen relationships and trust between people.",
  "- [quiet-competence] Quiet Competence: Mastery shown, not announced. Show the work; skip the triumphalism.",
  "- [coordination] Coordination & Governance: How groups decide, align, and keep promises at scale.",
  "Strategy note: Every piece must serve at least one throughline. If it doesn't, name the nearest strategic angle and the smallest pivot that would land it there. We never recommend killing a piece — only redirecting it.",
  "",
  "AUDIENCES:",
  "- [leaders] Leaders in personal spheres: People who shape a community, team, or family. Care about responsibility and example.",
  "- [builders] Builders & founders: Shipping things. Want leverage, honesty about tradeoffs, and no hype.",
  "- [women-ai] Women curious about AI: Smart, skeptical, underserved by hype-cycle coverage. Want a grounded on-ramp.",
  "- [governance] Governance & coordination thinkers: Mechanism-minded. Care about incentives, institutions, and failure modes.",
  "- [relational] Existing relational audience: People who already know and trust the author. Speak as a continuing conversation.",
  "- [general] General public bridge: No prior context. Need the stakes made plain without condescension.",
  "",
  "REGISTERS:",
  "- [essay] Essay register: Measured, literary, first-person, comfortable with a long sentence and a turn. For Substack and reflective long-form. Earns its claims slowly.",
  "- [field] Field register: Direct, plain, second-person-friendly, short sentences. For relational platforms and practical posts. Warm, not breezy.",
  "Detect which register a piece is in. Flag register mixing (an essay sentence dropped into a field post, or vice versa) and voice drift (sentences that sound generic-LinkedIn, not like the author).",
  "",
  "CLARITY RULES:",
  "1. The central claim appears in the first two lines.",
  "2. Each paragraph does exactly one job.",
  "3. Actors and actions are visible — name who does what; avoid hidden subjects and nominalizations.",
  "4. Every term is either defined on first use or cut.",
  "5. Every number carries its meaning — no naked statistics.",
  "6. Prefer the concrete noun to the abstract category.",
  "7. A line that sounds like the author always beats a tidier generic line.",
  "",
  "RED LINES:",
  "- No claims of certainty about others' internal states or motives.",
  "- No dunking, no contempt, no quote-tweet hostility — disagree with the strongest version.",
  "- No private details about named real people without consent.",
  "- No fear-based AI doom framing as a hook; stakes stated soberly.",
  "- No selling in the first beat of a relational post; offerings come last and optional.",
  "- Never overclaim empirical results; testimony is fine as testimony.",
  "",
  "SELF-VISION (public identity):",
  "The author is a builder who writes: technically fluent but not a hype-man, warm but exacting, more interested in good questions than hot takes. Optimistic about technology in service of human relationship and judgment. Reads as a person thinking in public, not a brand performing authority. Self-alignment gate flags anything that contradicts this — false bravado, manufactured outrage, borrowed jargon, or certainty the author wouldn't actually claim.",
].join("\n");

describe("buildRefContext", () => {
  it("produces the byte-identical golden string for SEED_REFERENCES", () => {
    expect(buildRefContext(SEED_REFERENCES)).toBe(GOLDEN);
  });

  it("returns an empty string for empty / nullish input", () => {
    expect(buildRefContext({})).toBe("");
    expect(buildRefContext(null)).toBe("");
    expect(buildRefContext(undefined)).toBe("");
  });

  it("guards each list with `|| []` (block headers present, no rows)", () => {
    const out = buildRefContext({
      strategy: {},
      audiences: {},
      registers: {},
      voiceRules: {},
      redLines: {},
    });
    expect(out).toBe(
      [
        "THROUGHLINES:",
        "",
        "AUDIENCES:",
        "",
        "REGISTERS:",
        "",
        "CLARITY RULES:",
        "",
        "RED LINES:",
      ].join("\n"),
    );
  });

  it("omits SELF-VISION when body is missing", () => {
    expect(buildRefContext({ selfVision: {} })).toBe("");
  });
});
