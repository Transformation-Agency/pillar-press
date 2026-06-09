/**
 * Platform generators (Unit U3.3) — server port of the platform-generation
 * half of prototype-reference/generators.js (window.GEN).
 *
 * SOURCE OF TRUTH: prototype-reference/generators.js. The PLATFORMS table,
 * resolveSources / canonicalSource ordering, the TWO-calls-per-platform shape
 * (delimiter @@POST@@ body + compact metadata JSON), and the exact output
 * object fields are ported VERBATIM. Only the AI seam changes: the prototype's
 * `window.AI.text/json` becomes an injected {@link AI} (lib/llm), so
 * the pure functions are unit-testable WITHOUT a database or network.
 *
 * The proposed-revision half of generators.js lives in the SEPARATE file
 * lib/revision.ts — do not duplicate it here; coordinate only via imports.
 *
 * Every exported function is pure over its inputs (piece data, refCtx, ai):
 * the route handler (app/api/pieces/[id]/outputs/route.ts) does auth + db +
 * calls generateOutputs + persists `outputs` and `output_order`.
 */
import type { AI } from "@/lib/llm";

/* ---------- Audience presets (ported verbatim from generators.js) ---------- */

export interface AudiencePreset {
  id: string;
  name: string;
}

export const AUDIENCE_PRESETS: readonly AudiencePreset[] = [
  { id: "leaders", name: "Leaders in personal spheres" },
  { id: "builders", name: "Builders & founders" },
  { id: "women-ai", name: "Women curious about AI" },
  { id: "governance", name: "Governance & coordination thinkers" },
  { id: "relational", name: "Existing relational audience" },
  { id: "general", name: "General public bridge" },
];

/* ---------- Platforms (ported verbatim from generators.js) ----------
   Fixed generation order. Each platform names which prior outputs it prefers
   to derive from; falls back to the canonical source if absent. */

export interface Platform {
  id: string;
  name: string;
  order: number;
  register: string;
  derivesFrom: string[];
  role: string;
}

export const PLATFORMS: readonly Platform[] = [
  { id: "substack", name: "Substack", order: 1, register: "essay",
    derivesFrom: [], role: "Canonical source. The fullest expression — long-form essay register." },
  { id: "facebook", name: "Facebook", order: 2, register: "field",
    derivesFrom: ["substack"], role: "Relational adaptation of the canonical source. Warm, personal, field register." },
  { id: "instagram", name: "Instagram", order: 3, register: "field",
    derivesFrom: ["facebook"], role: "Visual adaptation of the Facebook version. Include image/carousel/Reel recommendation." },
  { id: "x", name: "X", order: 4, register: "field",
    derivesFrom: ["substack", "facebook"], role: "Strongest theses and distinctions from the Substack + Facebook versions. Thread-friendly." },
  { id: "threads", name: "Threads", order: 5, register: "field",
    derivesFrom: ["facebook", "x"], role: "Conversational register, built from the Facebook + X versions." },
];

/* ---------- The persisted output object ---------- */

export interface PlatformOutput {
  platform: string;
  selectedAudience: string;
  throughlineTag: string;
  strategicPurpose: string;
  draftPost: string;
  hooks: string[];
  ctas: string[];
  mediaRec: string;
  riskCheck: string;
  relatedOffering: string;
  followUp: string;
  _platform: string;
  _audienceId: string;
}

/** Minimal piece shape consumed by generateOutputs (matches the prototype). */
export interface GeneratorPiece {
  original?: string | null;
  revision?: { text?: string | null; revision?: string | null } | null;
}

/* ---------- Source resolution (ported verbatim) ---------- */

/**
 * canonicalSource — the fullest source text to derive from. Prefers the
 * proposed revision, then its legacy `revision` field, then the original.
 */
export function canonicalSource(piece: GeneratorPiece): string {
  if (piece.revision && piece.revision.text) return piece.revision.text;
  if (piece.revision && piece.revision.revision) return piece.revision.revision;
  return piece.original || "";
}

/**
 * resolveSources — given the set of ON platforms, resolve the actual source for
 * each. If a platform's preferred derivesFrom isn't ON, fall back to the
 * canonical source ("__source__"). Pure + unit-testable.
 *
 * The fixed order (Substack → Facebook → Instagram → X → Threads) means that
 * with Substack off, Facebook resolves to the canonical source and the rest
 * thread off the still-active platforms.
 */
export function resolveSources(activeIds: string[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  PLATFORMS.forEach((p) => {
    if (!activeIds.includes(p.id)) return;
    const present = p.derivesFrom.filter((d) => activeIds.includes(d));
    map[p.id] = present.length ? present : ["__source__"];
  });
  return map;
}

/* ---------- Per-platform generation (TWO calls: body + metadata) ---------- */

export interface GeneratePlatformInput {
  sourceText: string;
  priorOutputs: Record<string, PlatformOutput>;
  sourceIds: string[];
  audienceId?: string;
  refCtx: string;
}

interface PlatformMeta {
  throughlineTag?: string;
  strategicPurpose?: string;
  hooks?: unknown;
  ctas?: unknown;
  mediaRec?: string;
  riskCheck?: string;
  relatedOffering?: string;
  followUp?: string;
}

/**
 * generatePlatform — produce one platform-native output. Two AI calls:
 *   1) the POST BODY in @@POST@@ … @@END@@ delimiter format (so a long body can
 *      never truncate the structured fields), then
 *   2) compact metadata JSON computed against the finished body.
 *
 * Ported VERBATIM from generators.js#generatePlatform; `window.AI` is replaced
 * by the injected `ai`.
 */
export async function generatePlatform(
  platform: Platform,
  { sourceText, priorOutputs, sourceIds, audienceId, refCtx }: GeneratePlatformInput,
  ai: AI,
): Promise<PlatformOutput> {
  const aud = AUDIENCE_PRESETS.find((a) => a.id === audienceId) || AUDIENCE_PRESETS[0];

  let derivationText: string;
  if (sourceIds[0] === "__source__") {
    derivationText = `Derive from the CANONICAL SOURCE below.`;
  } else {
    derivationText = `Derive from these already-generated versions (named): ${sourceIds.map((s) => s.toUpperCase()).join(" + ")}. Use their strongest material. Do NOT merely excerpt — this is an independent entry point that may point back to the longer work.`;
  }

  const priorBlock = sourceIds[0] === "__source__"
    ? `CANONICAL SOURCE:\n"""${sourceText}"""`
    : sourceIds.map((s) => `=== ${s.toUpperCase()} VERSION ===\n${(priorOutputs[s] && priorOutputs[s].draftPost) || sourceText}`).join("\n\n");

  const igExtra = platform.id === "instagram"
    ? ` For Instagram, the imagery recommendation MUST specify a format: single image, carousel (with slide breakdown), or Reel (with a short beat list).`
    : "";

  /* --- Call 1: the POST BODY (delimiter format, no JSON escaping) ---
     Kept separate from the metadata so a long body can never truncate the
     structured fields. Distill rather than reproduce. */
  const bodySystem =
`You write the BODY of a single platform-native post for an author. ${platform.role}
Register to use: ${platform.register}. ${derivationText}
This is an INDEPENDENT entry point, never a mere excerpt; it may point back to the longer work. If the source is long, DISTILL it to one sharp idea rather than reproducing it — aim for a complete, well-shaped post and do not exceed ~550 words.

AUTHOR REFERENCES:
${refCtx}

Return EXACTLY this and nothing else (no JSON, no preamble):
@@POST@@
<the full post as plain prose; keep paragraph breaks as blank lines>
@@END@@`;
  const bodyPrompt =
`TARGET PLATFORM: ${platform.name}
SELECTED AUDIENCE: ${aud.name}

${priorBlock}

Write the post now in the delimited format.`;
  const bodyOut = await ai.text(bodyPrompt, { system: bodySystem });
  let draftPost = bodyOut || "";
  const pm = bodyOut.split(/@@\s*POST\s*@@/i);
  if (pm.length > 1) draftPost = pm[1].split(/@@\s*END\s*@@/i)[0];
  draftPost = draftPost.replace(/@@\s*END\s*@@[\s\S]*$/i, "").trim();

  /* --- Call 2: the METADATA (compact JSON, given the finished body) --- */
  const metaSystem =
`You produce publishing metadata for a FINISHED platform post written for an author. Base every field on the actual post text provided. Run a risk & boundary check against the author's RED LINES.

AUTHOR REFERENCES:
${refCtx}

Return ONLY compact valid JSON (no prose, no code fences):
{"throughlineTag":"<one throughline tag, no hash>","strategicPurpose":"1 sentence","hooks":["2-3 short alternative opening hooks"],"ctas":["2-3 call-to-action options"],"mediaRec":"<imagery/media recommendation${platform.id === "instagram" ? ", specify single image / carousel / Reel" : ""}>","riskCheck":"<'Clear' or the specific concern>","relatedOffering":"<related offering or destination>","followUp":"<one suggested follow-up post>"}`;
  const metaPrompt =
`PLATFORM: ${platform.name}
SELECTED AUDIENCE: ${aud.name}${igExtra}

THE POST:
"""${draftPost}"""

Return the metadata JSON now.`;
  let meta: PlatformMeta = {};
  try { meta = await ai.json<PlatformMeta>(metaPrompt, { system: metaSystem }); }
  catch (e) { console.warn("Platform metadata failed:", platform.id, e); }

  return {
    platform: platform.name,
    selectedAudience: aud.name,
    throughlineTag: (meta.throughlineTag || "").replace(/^#/, "") || "—",
    strategicPurpose: meta.strategicPurpose || "—",
    draftPost: draftPost || "—",
    hooks: Array.isArray(meta.hooks) ? meta.hooks : [],
    ctas: Array.isArray(meta.ctas) ? meta.ctas : [],
    mediaRec: meta.mediaRec || "—",
    riskCheck: meta.riskCheck || "Clear",
    relatedOffering: meta.relatedOffering || "—",
    followUp: meta.followUp || "—",
    _platform: platform.id,
    _audienceId: aud.id,
  };
}

/* ---------- Orchestration (ported verbatim) ---------- */

export interface GenerateOutputsResult {
  outputs: Record<string, PlatformOutput>;
  order: string[];
}

export type OutputsProgress = (
  platformId: string,
  state: "running" | "done" | "error",
  output?: PlatformOutput | null,
  error?: unknown,
) => void;

/**
 * generateOutputs — run the active platforms in the fixed PLATFORMS order,
 * threading each platform's prior outputs into the next. Returns
 * `{ outputs, order }`; the route persists these to `outputs` / `output_order`.
 *
 * Ported VERBATIM from generators.js#generateOutputs; `window.AI` is replaced
 * by the injected `ai`.
 */
export async function generateOutputs(
  piece: GeneratorPiece,
  activeIds: string[],
  audienceMap: Record<string, string | undefined>,
  refCtx: string,
  ai: AI,
  onProgress?: OutputsProgress,
): Promise<GenerateOutputsResult> {
  const ordered = PLATFORMS.filter((p) => activeIds.includes(p.id));
  const sources = resolveSources(activeIds);
  const sourceText = canonicalSource(piece);
  const outputs: Record<string, PlatformOutput> = {};
  const order: string[] = [];
  for (const platform of ordered) {
    if (onProgress) onProgress(platform.id, "running");
    try {
      const res = await generatePlatform(platform, {
        sourceText,
        priorOutputs: outputs,
        sourceIds: sources[platform.id],
        audienceId: audienceMap[platform.id],
        refCtx,
      }, ai);
      outputs[platform.id] = res;
      order.push(platform.id);
      if (onProgress) onProgress(platform.id, "done", res);
    } catch (e) {
      if (onProgress) onProgress(platform.id, "error", null, e);
      throw e;
    }
  }
  return { outputs, order };
}
