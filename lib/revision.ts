/**
 * Proposed Revision — VERBATIM port of
 * prototype-reference/generators.js#generateRevision (+ chunkText, parseDelimited).
 *
 * Applies ONLY clarity, tone, and inoculation (screenshot-test) findings.
 * Strategy / audience / rigor / identity findings stay in the report — this is
 * the FIREWALL: only the clarity/tone/stress-screenshot slices of the packet may
 * inform the revision. The pure functions here (chunkText, parseDelimited,
 * collectFirewallFindings, buildFindingsBlock, REVISION_SYSTEM) take no database
 * and no network, so they are unit-testable with a fake AI.
 *
 * Parity notes:
 *  - chunkText: ≤260 words, paragraph split then sentence split, ported verbatim.
 *  - DELIMITER format @@REVISION@@ / @@CHANGELOG@@ / @@END@@ + parseDelimited,
 *    changelog finding ids C#/T#/I#, ported verbatim.
 *  - The system prompt is byte-identical to the prototype.
 *  - Each passage is processed in its own call so no single call exceeds the
 *    output budget; on a failed passage the original chunk is kept.
 *  - Output uses DATA_MODEL field name "text" (not the prototype's "revision"
 *    key): the route persists revision = { text, changelog }.
 */

import type { AI } from "@/lib/llm";

/* ------------------------------------------------------------------ *
 * Packet shapes (the FIREWALL inputs). Every field optional/guarded — the
 * prototype reads them with `|| []` truthiness checks.
 * ------------------------------------------------------------------ */

export type Severity = "must" | "consider" | "note";

export interface GateFinding {
  severity: Severity;
  title: string;
  detail: string;
  anchor?: string | null;
}

export interface ScreenshotTest {
  quote: string;
  misread?: string;
  inoculation: string;
}

export interface GateResult {
  summary?: string;
  findings?: GateFinding[];
  screenshotTests?: ScreenshotTest[];
}

/**
 * The packet the reviser may read. There are two passes:
 *  - LIGHT (default): collectFirewallFindings()/buildFindingsBlock() read ONLY
 *    clarity, tone, and stress.screenshotTests — the FIREWALL. strategy /
 *    audience / rigor / self never inform this pass.
 *  - FULL (opt-in): a preceding restructure step (buildFullFindingsBlock /
 *    restructureDraft) ALSO applies strategy / audience / rigor / self and may
 *    reorganize the document; the light pass then polishes the result.
 * The firewall for the light pass is enforced in those functions and in
 * REVISION_SYSTEM — not by this type.
 */
export interface RevisionPacket {
  strategy?: GateResult;
  audience?: GateResult;
  tone?: GateResult;
  rigor?: GateResult;
  stress?: GateResult;
  clarity?: GateResult;
  self?: GateResult;
}

export interface RevisionPieceInput {
  original?: string;
  packet?: RevisionPacket | null;
  // The author's explicit guidance — overrides findings where they conflict (as
  // long as voice is preserved). gateNotes is keyed by gate id (all seven), so it
  // can carry intent for strategy/identity gates the firewall excludes from findings.
  gateNotes?: Record<string, string> | null;
  direction?: string | null;
}

const GATE_LABELS: Record<string, string> = {
  strategy: "Strategy alignment", audience: "Audience", tone: "Tone & register",
  rigor: "Rigor", stress: "Stress test", clarity: "Clarity", self: "Self-alignment",
};

/** Build the author-guidance blocks (creative direction + per-gate commentary). */
export function buildGuidance(piece: RevisionPieceInput): { direction: string; notesBlock: string; hasGuidance: boolean } {
  const noteEntries = Object.entries(piece.gateNotes ?? {}).filter(([, v]) => (v || "").trim());
  const notesBlock = noteEntries.map(([id, v]) => `• ${GATE_LABELS[id] ?? id}: ${(v as string).trim()}`).join("\n");
  const direction = (piece.direction ?? "").trim();
  return { direction, notesBlock, hasGuidance: !!direction || !!notesBlock };
}

export interface ChangelogEntry {
  finding: string;
  change: string;
  note: string;
}

export interface RevisionResult {
  text: string;
  changelog: ChangelogEntry[];
}

export type OnProgress = (done: number, total: number) => void;

/* ------------------------------------------------------------------ *
 * chunkText — VERBATIM from generators.js
 * ------------------------------------------------------------------ */

export function chunkText(text: string, maxWords = 260): string[] {
  const paras = (text || "").split(/\n{2,}/);
  const chunks: string[] = [];
  let cur: string[] = [];
  let curW = 0;
  const flush = () => {
    if (cur.length) {
      chunks.push(cur.join("\n\n"));
      cur = [];
      curW = 0;
    }
  };
  const wc = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  for (const p of paras) {
    const w = wc(p);
    if (w > maxWords) {
      flush();
      const sents = p.match(/[^.!?]+[.!?]+[\s"”’)]*|[^.!?]+$/g) || [p];
      let sc: string[] = [];
      let scw = 0;
      for (const s of sents) {
        const sw = wc(s);
        if (scw + sw > maxWords && sc.length) {
          chunks.push(sc.join("").trim());
          sc = [];
          scw = 0;
        }
        sc.push(s);
        scw += sw;
      }
      if (sc.length) chunks.push(sc.join("").trim());
    } else if (curW + w > maxWords && cur.length) {
      flush();
      cur.push(p);
      curW = w;
    } else {
      cur.push(p);
      curW += w;
    }
  }
  flush();
  return chunks.length ? chunks : [text || ""];
}

/* ------------------------------------------------------------------ *
 * parseDelimited — VERBATIM from generators.js
 * ------------------------------------------------------------------ */

/** Light-pass finding ids: C#/T#/I# (brackets optional). Verbatim default. */
const DEFAULT_ID_RE = /^\[?\s*([CTI]\s*\d+)\s*\]?/i;
/** Full-pass restructure ids: any bracketed token (S1, A2, R1, V1, STRUCT). */
const RESTRUCTURE_ID_RE = /^\[\s*([A-Za-z0-9]{1,12})\s*\]/;

export function parseDelimited(
  out: string,
  idRegex: RegExp = DEFAULT_ID_RE,
): { revision: string; changelog: ChangelogEntry[] } {
  let body = out || "";
  let changelog: ChangelogEntry[] = [];
  const rev = (out || "").split(/@@\s*REVISION\s*@@/i);
  if (rev.length > 1) {
    const after = rev[1].split(/@@\s*CHANGELOG\s*@@/i);
    body = after[0];
    const cl = (after[1] || "").split(/@@\s*END\s*@@/i)[0];
    changelog = cl
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => /^[-•]/.test(l))
      .map((l) => {
        l = l.replace(/^[-•]\s*/, "");
        let finding = "—";
        const idm = l.match(idRegex);
        if (idm) {
          finding = idm[1].replace(/\s+/g, "").toUpperCase();
          l = l.slice(idm[0].length);
        }
        l = l.replace(/^\s*\[[^\]]*\]\s*/, ""); // drop an optional [severity] tag
        const parts = l.split(/\s*::\s*/);
        return {
          finding,
          change: (parts[0] || "").replace(/^[—:\-\s]+/, "").trim(),
          note: (parts[1] || "").trim(),
        };
      })
      .filter((c) => c.change);
  }
  body = body
    .replace(/@@\s*END\s*@@[\s\S]*$/i, "")
    .replace(/@@\s*CHANGELOG\s*@@[\s\S]*$/i, "")
    .trim();
  return { revision: body, changelog };
}

/* ------------------------------------------------------------------ *
 * FIREWALL — only clarity / tone / inoculation findings may pass.
 * collectFirewallFindings reads ONLY packet.clarity, packet.tone, and
 * packet.stress.screenshotTests; it can never see strategy/audience/rigor/self.
 * ------------------------------------------------------------------ */

export function collectFirewallFindings(packet: RevisionPacket | null | undefined) {
  const p = packet || {};
  const clarity = (p.clarity && p.clarity.findings) || [];
  const tone = (p.tone && p.tone.findings) || [];
  const inoc = (p.stress && p.stress.screenshotTests) || [];
  return { clarity, tone, inoc };
}

export function buildFindingsBlock(packet: RevisionPacket | null | undefined): string {
  const { clarity, tone, inoc } = collectFirewallFindings(packet);
  return [
    "CLARITY FINDINGS:",
    ...clarity.map(
      (f, i) =>
        `C${i + 1} [${f.severity}] ${f.title} — ${f.detail}${f.anchor ? ` (re: "${f.anchor}")` : ""}`,
    ),
    "\nTONE FINDINGS:",
    ...tone.map(
      (f, i) =>
        `T${i + 1} [${f.severity}] ${f.title} — ${f.detail}${f.anchor ? ` (re: "${f.anchor}")` : ""}`,
    ),
    "\nINOCULATIONS (from screenshot test):",
    ...inoc.map((s, i) => `I${i + 1} re "${s.quote}": ${s.inoculation}`),
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * FULL pass — the restructure step. Reads the dimensions the firewall
 * excludes (strategy / audience / rigor / self) and may reorganize the
 * whole document. Runs BEFORE the light per-passage pass when mode:"full".
 * ------------------------------------------------------------------ */

/** [gate key, changelog id prefix, label] for the dimensions the restructure applies. */
const FULL_GATES: Array<[keyof RevisionPacket, string, string]> = [
  ["strategy", "S", "STRATEGY"],
  ["audience", "A", "AUDIENCE"],
  ["rigor", "R", "RIGOR"],
  ["self", "V", "SELF-ALIGNMENT (voice/identity — guide, don't flatten)"],
];

export function buildFullFindingsBlock(packet: RevisionPacket | null | undefined): string {
  const p = (packet || {}) as Record<string, GateResult | undefined>;
  const blocks: string[] = [];
  for (const [key, prefix, label] of FULL_GATES) {
    const findings = (p[key as string] && p[key as string]!.findings) || [];
    blocks.push(`${label} FINDINGS:`);
    findings.forEach((f, i) =>
      blocks.push(`${prefix}${i + 1} [${f.severity}] ${f.title} — ${f.detail}${f.anchor ? ` (re: "${f.anchor}")` : ""}`),
    );
  }
  return blocks.join("\n");
}

export function RESTRUCTURE_SYSTEM(refCtx: string, guidance?: { direction: string; notesBlock: string; hasGuidance: boolean }): string {
  const g = guidance ?? { direction: "", notesBlock: "", hasGuidance: false };
  const eClause = g.hasGuidance
    ? `\n(f) HONOR THE AUTHOR'S DIRECTION & SECTION COMMENTARY below — they govern the approach and emphasis and take precedence over the findings where they conflict. When a change is driven by author guidance (not a finding), tag its changelog line [DIR].`
    : "";
  const directionBlock = g.direction ? `\n\nAUTHOR'S CREATIVE DIRECTION (apply throughout):\n${g.direction}` : "";
  const notesBlock = g.notesBlock ? `\n\nAUTHOR COMMENTARY BY REVIEW SECTION (apply where relevant):\n${g.notesBlock}` : "";
  return `You are the structural editor in an editorial system for a single author. You revise the WHOLE piece at once. Your job is the document's STRATEGY and STRUCTURE — not line-level polish (clarity, tone, and inoculation are applied in a later pass).
(a) You MAY reorganize: reorder, merge, split, or add/cut sections, and sharpen the through-line so the piece serves its strategy and audience and stands up to scrutiny;
(b) apply the strategy, audience, rigor, and self-alignment findings below;
(c) PRESERVE the author's VOICE and identity — where a line sounds like the author, keep it verbatim; never flatten the author's register, and treat self-alignment findings as a guide to protect the author's voice, not license to rewrite their persona;
(d) do NOT invent facts, data, citations, or claims; restructure and strengthen what is already there;
(e) make changes that genuinely serve the piece; if the structure is already sound, return it unchanged with an empty changelog.${eClause}

AUTHOR REFERENCES:
${refCtx}${directionBlock}${notesBlock}

Return EXACTLY this format and NOTHING else (no JSON, no preamble):
@@REVISION@@
<the restructured piece as plain prose; keep paragraph breaks as blank lines; you may use section headings>
@@CHANGELOG@@
- [id] what changed :: short why
@@END@@
(One line per structural/strategic change. id is bracketed, like [S1] (strategy), [A1] (audience), [R1] (rigor), [V1] (self/voice), or [STRUCT] for a reorganization. Omit the line if nothing changed.)`;
}

/**
 * restructureDraft — the FULL pass's first step: one whole-document call that
 * applies strategy/audience/rigor/self and may reorganize the piece. Returns the
 * restructured text + a structural changelog. On failure the caller falls back
 * to the original text (light pass only).
 */
export async function restructureDraft(
  piece: RevisionPieceInput,
  refCtx: string,
  ai: AI,
): Promise<{ text: string; changelog: ChangelogEntry[] }> {
  const system = RESTRUCTURE_SYSTEM(refCtx, buildGuidance(piece));
  const prompt = `STRATEGY / AUDIENCE / RIGOR / SELF FINDINGS — apply these and improve the document's structure (clarity, tone, and inoculation are handled in a later polishing pass):
${buildFullFindingsBlock(piece.packet || {})}

FULL DRAFT:
"""${piece.original || ""}"""

Return the delimited format now.`;
  const out = await ai.text(prompt, { system });
  const parsed = parseDelimited(out, RESTRUCTURE_ID_RE);
  return { text: parsed.revision, changelog: parsed.changelog };
}

/* ------------------------------------------------------------------ *
 * System prompt — byte-identical to generators.js (refCtx interpolated).
 * ------------------------------------------------------------------ */

export function REVISION_SYSTEM(refCtx: string, guidance?: { direction: string; notesBlock: string; hasGuidance: boolean }): string {
  const g = guidance ?? { direction: "", notesBlock: "", hasGuidance: false };
  const eClause = g.hasGuidance
    ? `\n(e) HONOR THE AUTHOR'S DIRECTION & SECTION COMMENTARY below — they govern the approach, emphasis, and tone of the rewrite and take precedence over the findings where they conflict, as long as you stay in the author's voice. When a change is driven by author guidance (not a finding), tag its changelog line [DIR].`
    : "";
  const directionBlock = g.direction ? `\n\nAUTHOR'S CREATIVE DIRECTION (apply throughout):\n${g.direction}` : "";
  const notesBlock = g.notesBlock ? `\n\nAUTHOR COMMENTARY BY REVIEW SECTION (the author's specific notes on each gate — apply where relevant to this passage):\n${g.notesBlock}` : "";
  return `You are the reviser in an editorial system for a single author. You revise ONE PASSAGE of a longer piece at a time. For the passage you are given:
(a) PRESERVE the author's structure and register;
(b) apply ONLY the clarity, tone, and inoculation findings that are relevant to THIS passage — do NOT act on strategy, audience, rigor, or identity concerns;
(c) obey absolutely: where a clarity rule would flatten a line that sounds like the author, the AUTHOR'S LINE WINS — keep it verbatim;
(d) make the smallest changes that satisfy the findings; if the passage needs no change, return it unchanged with an empty changelog.${eClause}

AUTHOR REFERENCES:
${refCtx}${directionBlock}${notesBlock}

Return EXACTLY this format and NOTHING else (no JSON, no preamble):
@@REVISION@@
<the revised passage as plain prose; keep paragraph breaks as blank lines>
@@CHANGELOG@@
- [findingId] what changed :: short why
@@END@@
(One changelog line per change. findingId is like C2, T1, or I3. Omit the line entirely if nothing changed.)`;
}

/* ------------------------------------------------------------------ *
 * generateRevision — VERBATIM port of generators.js#generateRevision.
 * Pure: takes (piece, refCtx, ai, onProgress). No db, no network beyond `ai`.
 * Returns { text, changelog } (DATA_MODEL field name "text").
 * ------------------------------------------------------------------ */

export interface RevisionOptions {
  /** "light" (default): firewall pass only. "full": restructure (strategy /
   *  audience / rigor / self + reorganization) THEN the firewall polish pass. */
  mode?: "light" | "full";
}

export async function generateRevision(
  piece: RevisionPieceInput,
  refCtx: string,
  ai: AI,
  onProgress?: OnProgress,
  opts?: RevisionOptions,
): Promise<RevisionResult> {
  const mode = opts?.mode === "full" ? "full" : "light";
  const packet = piece.packet || {};
  const findingsBlock = buildFindingsBlock(packet);
  const system = REVISION_SYSTEM(refCtx, buildGuidance(piece));

  // FULL mode: a whole-document restructure pass first (strategy/structure/etc.),
  // then the per-passage firewall polish runs over the restructured text.
  let baseText = piece.original || "";
  let preChangelog: ChangelogEntry[] = [];
  if (mode === "full") {
    try {
      const r = await restructureDraft(piece, refCtx, ai);
      if (r.text && r.text.trim().length > 2) baseText = r.text;
      preChangelog = r.changelog;
    } catch (e) {
      console.warn("Restructure pass failed; falling back to per-passage polish only:", e);
    }
  }

  const chunks = chunkText(baseText, 260);
  const revisions: string[] = [];
  let changelog: ChangelogEntry[] = preChangelog.slice();
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(i, chunks.length);
    const prompt = `FINDINGS AVAILABLE (apply only those relevant to this passage):
${findingsBlock}

PASSAGE ${i + 1} OF ${chunks.length}:
"""${chunks[i]}"""

Return the delimited format now.`;
    try {
      const out = await ai.text(prompt, { system });
      const parsed = parseDelimited(out);
      revisions.push(parsed.revision && parsed.revision.length > 2 ? parsed.revision : chunks[i]);
      changelog = changelog.concat(parsed.changelog);
    } catch (e) {
      console.warn("Revision passage failed, keeping original:", i, e);
      revisions.push(chunks[i]);
    }
  }
  if (onProgress) onProgress(chunks.length, chunks.length);
  return { text: revisions.join("\n\n"), changelog };
}
