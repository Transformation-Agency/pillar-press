/**
 * Gates — the seven editorial review passes.
 *
 * VERBATIM port of prototype-reference/gates.js. The prototype is the SOURCE OF
 * TRUTH for prompts/shapes: GATES (the 7 gate definitions + their exact
 * per-gate JSON output schemas and task() prompts), the shared system PREAMBLE,
 * SEVERITY, the FINDING_SHAPE, runGate(), and finding normalization are all
 * carried over unchanged. Browser globals (window.AI / window.runGate) are
 * replaced by the injectable AI interface so the gate logic stays PURE and
 * unit-testable WITHOUT a database or network.
 *
 * Each gate is a separate AI call returning structured JSON, so the Workbench
 * can fill its rail gate-by-gate (the review route persists piece.packet[gateId]
 * incrementally after each gate).
 */
import type { AI } from "@/lib/llm";

export type Severity = "must" | "consider" | "note";

export type GateKind =
  | "strategy"
  | "audience"
  | "tone"
  | "rigor"
  | "stress"
  | "clarity"
  | "self";

export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  /** A short verbatim phrase copied EXACTLY from the draft, or null. */
  anchor: string | null;
}

export interface Gate {
  id: GateKind;
  n: number;
  name: string;
  kind: GateKind;
  blurb: string;
  task: (draft: string) => string;
}

/** A gate result is the per-gate JSON object, always including findings. */
export type GateResult = Record<string, unknown> & { findings: Finding[] };

// ---- VERBATIM from gates.js ------------------------------------------------

const FINDING_SHAPE =
  `Each finding: {"severity":"must"|"consider"|"note","title":"<=8 words","detail":"1-2 sentences","anchor":"<a short verbatim phrase copied EXACTLY from the draft that this finding points to, or null>"}. ` +
  `severity: "must" = Must-fix, "consider" = Consider, "note" = Note. Order findings by severity (must first).`;

export const PREAMBLE = (refCtx: string): string =>
`You are one gate in an editorial review system for a single author. You never recommend killing a piece. You respect the author's voice. Be specific and concise — you have a limited output budget, so prioritize the most important findings (aim for 2-5) over exhaustiveness.

AUTHOR REFERENCE DOCUMENTS (authoritative — read the current versions):
${refCtx}

Return ONLY valid JSON. No prose outside the JSON. No code fences.`;

export const GATES: Gate[] = [
  {
    id: "strategy", n: 1, name: "Strategy alignment", kind: "strategy",
    blurb: "Which throughline does this serve?",
    task: (draft) =>
`TASK — Strategy alignment. Decide which defined throughline(s) this piece serves. If none clearly fit, name the nearest strategic angle and the smallest pivot to land it there. NEVER recommend killing the piece.
Schema: {"summary":"1-2 sentences","servedThroughlines":["tag", ...],"nearestAngle":"<only if none served, else null>","findings":[ ${FINDING_SHAPE} ]}

DRAFT:
"""${draft}"""`,
  },
  {
    id: "audience", n: 2, name: "Audience", kind: "audience",
    blurb: "Best-fit audience & split-audience flags.",
    task: (draft) =>
`TASK — Audience. Score the piece's fit against each defined audience (0-100). Recommend the SINGLE best audience. Flag any place the piece talks to two audiences at once.
Schema: {"summary":"1-2 sentences","recommended":{"id":"<audience id>","name":"<name>","why":"1 sentence"},"scores":[{"id":"<id>","name":"<name>","score":0-100}],"findings":[ ${FINDING_SHAPE} ]}

DRAFT:
"""${draft}"""`,
  },
  {
    id: "tone", n: 3, name: "Tone & register", kind: "tone",
    blurb: "Which register? Mixing & drift.",
    task: (draft) =>
`TASK — Tone & register. Detect which defined register the piece is in. Flag register mixing (sentences from the other register) and voice drift (generic/LinkedIn-sounding lines unlike the author).
Schema: {"summary":"1-2 sentences","detectedRegister":{"id":"<register id>","name":"<name>"},"findings":[ ${FINDING_SHAPE} ]}

DRAFT:
"""${draft}"""`,
  },
  {
    id: "rigor", n: 4, name: "Rigor", kind: "rigor",
    blurb: "Checkable claims & verification queries.",
    task: (draft) =>
`TASK — Rigor. Identify every checkable claim. Classify each as one of: "historical" (historical fact), "named-claim" (claim about a named person or field), "empirical" (empirical claim), "testimony" (personal testimony — EXEMPT from verification). For non-testimony claims give a suggested verification query. Flag anything that reads as overclaimed.
Schema: {"summary":"1-2 sentences","claims":[{"text":"<the claim, short quote>","type":"historical"|"named-claim"|"empirical"|"testimony","overclaimed":true|false,"verificationQuery":"<search query, or null if testimony>"}],"findings":[ ${FINDING_SHAPE} ]}

DRAFT:
"""${draft}"""`,
  },
  {
    id: "stress", n: 5, name: "Stress test", kind: "stress",
    blurb: "Steelman, counters, screenshot test.",
    task: (draft) =>
`TASK — Stress test. Provide: (1) one full STEELMAN of the strongest opposing argument, stated as its best advocate would; (2) the TWO next-strongest counters; (3) a "screenshot test": the 2-3 most likely bad-faith readings if a hostile reader quoted the piece out of context, each with a suggested inoculation (a revision or addition that defuses it).
Schema: {"summary":"1 sentence","steelman":"<paragraph>","counters":["<counter 1>","<counter 2>"],"screenshotTests":[{"quote":"<the line likely to be screenshotted, verbatim if possible>","misread":"<the bad-faith reading>","inoculation":"<how to inoculate>"}],"findings":[ ${FINDING_SHAPE} ]}

DRAFT:
"""${draft}"""`,
  },
  {
    id: "clarity", n: 6, name: "Clarity", kind: "clarity",
    blurb: "Communication rules, line by line.",
    task: (draft) =>
`TASK — Clarity. Apply the author's CLARITY RULES. Check: is the central claim in the first two lines; does each paragraph do one job; are actors and actions visible; is every term defined or cut; does every number carry its meaning. For each issue, name the rule it violates in the finding title.
Schema: {"summary":"1-2 sentences","findings":[ ${FINDING_SHAPE} ]}

DRAFT:
"""${draft}"""`,
  },
  {
    id: "self", n: 7, name: "Self-alignment", kind: "self",
    blurb: "Does this sound like the author?",
    task: (draft) =>
`TASK — Self-alignment. Does this piece sound like the author the SELF-VISION describes? Flag anything that contradicts the public identity — false bravado, manufactured outrage, borrowed jargon, or certainty the author wouldn't claim.
Schema: {"summary":"1-2 sentences","findings":[ ${FINDING_SHAPE} ]}

DRAFT:
"""${draft}"""`,
  },
];

/**
 * Run a single gate. PURE: takes the AI interface so it is testable with a fake
 * (no DB, no network). Mirrors gates.js#runGate, including finding normalization
 * (severity filter + anchor = verbatim draft quote or null).
 */
export async function runGate(
  gate: Gate,
  draft: string,
  refCtx: string,
  ai: AI,
): Promise<GateResult> {
  const system = PREAMBLE(refCtx);
  const result = await ai.json<GateResult>(gate.task(draft), { system });
  // normalize findings
  result.findings = ((result.findings as Finding[] | undefined) || []).map((f) => ({
    severity: (["must", "consider", "note"] as const).includes(f.severity) ? f.severity : "note",
    title: f.title || "Finding",
    detail: f.detail || "",
    anchor: f.anchor || null,
  }));
  return result;
}

export const SEVERITY: Record<
  Severity,
  { label: string; varc: string; bg: string; rank: number }
> = {
  must: { label: "Must-fix", varc: "--sev-must", bg: "--sev-must-bg", rank: 0 },
  consider: { label: "Consider", varc: "--sev-consider", bg: "--sev-consider-bg", rank: 1 },
  note: { label: "Note", varc: "--sev-note", bg: "--sev-note-bg", rank: 2 },
};
