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

import type { AI } from "@/lib/anthropic";

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

/**
 * The ONLY packet slices the firewall permits into a revision:
 * clarity findings, tone findings, and the stress gate's screenshot-test
 * inoculations. strategy / audience / rigor / self (identity) are deliberately
 * NOT part of this type — they must never inform the revision.
 */
export interface RevisionPacket {
  clarity?: { findings?: GateFinding[] };
  tone?: { findings?: GateFinding[] };
  stress?: { screenshotTests?: ScreenshotTest[] };
}

export interface RevisionPieceInput {
  original?: string;
  packet?: RevisionPacket | null;
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

export function parseDelimited(out: string): { revision: string; changelog: ChangelogEntry[] } {
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
        const idm = l.match(/^\[?\s*([CTI]\s*\d+)\s*\]?/i);
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
 * System prompt — byte-identical to generators.js (refCtx interpolated).
 * ------------------------------------------------------------------ */

export function REVISION_SYSTEM(refCtx: string): string {
  return `You are the reviser in an editorial system for a single author. You revise ONE PASSAGE of a longer piece at a time. For the passage you are given:
(a) PRESERVE the author's structure and register;
(b) apply ONLY the clarity, tone, and inoculation findings that are relevant to THIS passage — do NOT act on strategy, audience, rigor, or identity concerns;
(c) obey absolutely: where a clarity rule would flatten a line that sounds like the author, the AUTHOR'S LINE WINS — keep it verbatim;
(d) make the smallest changes that satisfy the findings; if the passage needs no change, return it unchanged with an empty changelog.

AUTHOR REFERENCES:
${refCtx}

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

export async function generateRevision(
  piece: RevisionPieceInput,
  refCtx: string,
  ai: AI,
  onProgress?: OnProgress,
): Promise<RevisionResult> {
  const packet = piece.packet || {};
  const findingsBlock = buildFindingsBlock(packet);
  const system = REVISION_SYSTEM(refCtx);

  const chunks = chunkText(piece.original || "", 260);
  const revisions: string[] = [];
  let changelog: ChangelogEntry[] = [];
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
