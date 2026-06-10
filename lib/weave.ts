/**
 * Weave — multi-file synthesis engine (map-reduce).
 *
 * VERBATIM server-side port of prototype-reference/weave.js. Every prompt
 * (system + user), the @@SECTION@@ / @@END@@ delimiter handling, the per-step
 * bounding, the equal-weighting instruction, and the failure fallbacks are kept
 * byte-for-byte from the prototype so output parity is preserved.
 *
 * Differences from the prototype, all mechanical (NOT behavioral):
 *  - `window.AI` is replaced by an injected {@link AI} (lib/llm), so the
 *    pipeline is PURE and unit-testable with a fake AI — no DB, no network.
 *  - `console.warn` becomes a no-op-safe console.warn (server console).
 *  - refCtx is passed in (built from a campaign's references via
 *    lib/refContext.ts#buildRefContext) instead of read from window.Store.
 *
 * Pipeline (every step bounded so file count/length never truncates):
 *   MAP    extractSource()      one call per file  -> compact extract
 *   REDUCE synthesizeBrief()    all extracts       -> emergent concept + structure
 *   MAP2   mapToThroughlines()  concept            -> author's References
 *   EXPAND draftSection()       one call per section-> unified draft
 */
import type { AI } from "@/lib/llm";

export interface WeaveSource {
  name: string;
  text: string;
}

export interface WeaveExtract {
  name: string;
  summary: string;
  themes: string[];
  claims: string[];
  signals: string[];
  lines: string[];
}

export interface WeaveStructureSection {
  section: string;
  purpose: string;
  draws: string[];
}

export interface WeaveBrief {
  workingTitle: string;
  concept: string;
  coreMessage: string;
  thread: string;
  tensions: string[];
  structure: WeaveStructureSection[];
}

export interface WeaveMappingEntry {
  tag: string;
  how: string;
}

export interface WeaveMapping {
  mapped: WeaveMappingEntry[];
  nearestAngle: string | null;
  audience: string;
  register: string;
}

export interface WeaveResult {
  extracts: WeaveExtract[];
  brief: WeaveBrief;
  mapping: WeaveMapping;
  draft: string;
  generatedAt: number;
}

export type WeaveProgress =
  | { phase: "extract"; i: number; total: number; name: string }
  | { phase: "brief" }
  | { phase: "map" }
  | { phase: "draft"; i: number; total: number; name: string }
  | { phase: "done" };

export type WeaveProgressFn = (p: WeaveProgress) => void;

/* ------------------------------------------------------------------ *
 * MAP — extract ONE source into a compact distillation.
 * ------------------------------------------------------------------ */
export async function extractSource(source: WeaveSource, ai: AI): Promise<WeaveExtract> {
  const system =
`You read ONE source document and distill it for a later synthesis step. Be compact — short phrases, not paragraphs. Capture what is distinctive about THIS source.
Return ONLY valid JSON (no prose, no fences):
{"summary":"1-2 sentences","themes":["3-5 short theme phrases"],"claims":["2-4 key claims, short"],"signals":["1-3 angle/throughline signals — what bigger idea this points to"],"lines":["1-2 notable verbatim lines worth keeping"]}`;
  const prompt = `SOURCE: "${source.name}"\n"""${source.text}"""\n\nReturn the JSON.`;
  const r = await ai.json<Partial<WeaveExtract>>(prompt, { system });
  return {
    name: source.name,
    summary: r.summary || "",
    themes: r.themes || [],
    claims: r.claims || [],
    signals: r.signals || [],
    lines: r.lines || [],
  };
}

function extractsBlock(extracts: WeaveExtract[]): string {
  return extracts.map((e, i) =>
`[S${i + 1}] ${e.name}
  summary: ${e.summary}
  themes: ${(e.themes || []).join("; ")}
  claims: ${(e.claims || []).join("; ")}
  signals: ${(e.signals || []).join("; ")}`).join("\n\n");
}

/* ------------------------------------------------------------------ *
 * REDUCE — find the EMERGENT concept that weaves all sources together.
 * ------------------------------------------------------------------ */
export async function synthesizeBrief(extracts: WeaveExtract[], ai: AI): Promise<WeaveBrief> {
  const system =
`You are a synthesis editor. You are given compact extracts from MANY separate source documents on different topics. Find the EMERGENT concept that weaves them into one coherent piece — not a summary of each, but the single idea that earns their being together. Weight all sources equally; surface the through-idea that none states alone.
Return ONLY valid JSON (no prose, no fences):
{"workingTitle":"<a real, specific working title>","concept":"<the unifying idea, 2-3 sentences>","coreMessage":"<the one-sentence message a reader should leave with>","thread":"<how the disparate topics connect — the connective logic, 2-3 sentences>","tensions":["1-3 productive tensions or contradictions across the sources worth using"],"structure":[{"section":"<section name>","purpose":"<what this section does>","draws":["S1","S3"]}]}
Make 'structure' a 3-6 part outline for a single essay.`;
  const prompt = `SOURCE EXTRACTS:\n${extractsBlock(extracts)}\n\nReturn the synthesis JSON.`;
  const r = await ai.json<Partial<WeaveBrief>>(prompt, { system });
  const workingTitle = r.workingTitle || "Untitled weave";
  const structure =
    Array.isArray(r.structure) && r.structure.length
      ? r.structure
      : [{ section: "Whole", purpose: "Make the case", draws: [] }];
  return {
    workingTitle,
    concept: r.concept || "",
    coreMessage: r.coreMessage || "",
    thread: r.thread || "",
    tensions: r.tensions || [],
    structure,
  };
}

/* ------------------------------------------------------------------ *
 * MAP2 — place the emergent concept onto the author's strategy.
 * ------------------------------------------------------------------ */
export async function mapToThroughlines(brief: WeaveBrief, refCtx: string, ai: AI): Promise<WeaveMapping> {
  const system =
`You map an emergent concept onto an author's defined strategy. First the concept emerged from the sources; now place it. Pick the throughline tags it genuinely serves and say how. If the fit is weak, name the nearest angle. Recommend the single best audience and a register.
AUTHOR REFERENCES:
${refCtx}
Return ONLY valid JSON (no prose, no fences):
{"mapped":[{"tag":"<throughline tag>","how":"<how the concept serves it, 1 sentence>"}],"nearestAngle":"<only if fit is weak, else null>","audience":"<best-fit audience name>","register":"<essay or field>"}`;
  const prompt = `EMERGENT CONCEPT:\nTitle: ${brief.workingTitle}\nConcept: ${brief.concept}\nCore message: ${brief.coreMessage}\nThread: ${brief.thread}\n\nReturn the mapping JSON.`;
  const r = await ai.json<Partial<WeaveMapping>>(prompt, { system });
  return {
    mapped: r.mapped || [],
    nearestAngle: r.nearestAngle ?? null,
    audience: r.audience || "",
    register: r.register || "essay",
  };
}

function digestFor(draws: string[] | undefined, extracts: WeaveExtract[]): string {
  const idxs = (draws || [])
    .map((d) => parseInt(String(d).replace(/[^0-9]/g, ""), 10) - 1)
    .filter((n) => n >= 0 && n < extracts.length);
  const chosen = idxs.length ? idxs.map((i) => extracts[i]) : extracts;
  return chosen.map((e) =>
`• ${e.name}: ${e.summary} ${(e.claims || []).join("; ")} ${(e.lines || []).map((l) => `“${l}”`).join(" ")}`).join("\n");
}

/* ------------------------------------------------------------------ *
 * EXPAND — write ONE section of the unified essay.
 * ------------------------------------------------------------------ */
export async function draftSection(
  section: WeaveStructureSection,
  idx: number,
  total: number,
  brief: WeaveBrief,
  mapping: WeaveMapping,
  extracts: WeaveExtract[],
  refCtx: string,
  ai: AI,
): Promise<string> {
  const register = (mapping && mapping.register) || "essay";
  const system =
`You write ONE SECTION of a single coherent essay that weaves many sources into one message. Write in the author's ${register} register and voice. Serve the piece's CORE MESSAGE; do not summarize sources — use them as material. Make the section flow from what came before (you are given the running outline). Do NOT restate the title or write a heading.
AUTHOR REFERENCES:
${refCtx}
Return EXACTLY this and nothing else:
@@SECTION@@
<the prose for this section; blank lines between paragraphs>
@@END@@`;
  const outline = brief.structure.map((s, i) => `${i + 1}. ${s.section}${i === idx ? "  <-- WRITE THIS ONE" : ""}`).join("\n");
  const prompt =
`PIECE
Title: ${brief.workingTitle}
Core message: ${brief.coreMessage}
Concept: ${brief.concept}
Connective thread: ${brief.thread}

FULL OUTLINE
${outline}

THIS SECTION (${idx + 1} of ${total}): ${section.section}
Its job: ${section.purpose}

MATERIAL TO DRAW FROM
${digestFor(section.draws, extracts)}

Write the section now in the delimited format.`;
  const out = await ai.text(prompt, { system });
  let body = out || "";
  const m = out.split(/@@\s*SECTION\s*@@/i);
  if (m.length > 1) body = m[1].split(/@@\s*END\s*@@/i)[0];
  return body.replace(/@@\s*END\s*@@[\s\S]*$/i, "").trim();
}

/* ------------------------------------------------------------------ *
 * runWeave — the full map-reduce. Pure: depends only on (sources, refCtx, ai).
 * ------------------------------------------------------------------ */
export async function runWeave(
  sources: WeaveSource[],
  refCtx: string,
  ai: AI,
  onProgress?: WeaveProgressFn,
): Promise<WeaveResult> {
  const usable = sources.filter((s) => (s.text || "").trim().length > 20);
  if (usable.length < 2) throw new Error("Add at least two sources with content to weave.");

  // MAP — extract each source
  const extracts: WeaveExtract[] = [];
  for (let i = 0; i < usable.length; i++) {
    if (onProgress) onProgress({ phase: "extract", i, total: usable.length, name: usable[i].name });
    try { extracts.push(await extractSource(usable[i], ai)); }
    catch (e) { console.warn("extract failed", usable[i].name, e); extracts.push({ name: usable[i].name, summary: (usable[i].text || "").slice(0, 200), themes: [], claims: [], signals: [], lines: [] }); }
  }

  // REDUCE — emergent brief
  if (onProgress) onProgress({ phase: "brief" });
  const brief = await synthesizeBrief(extracts, ai);

  // MAP2 — map onto references
  if (onProgress) onProgress({ phase: "map" });
  let mapping: WeaveMapping = { mapped: [], nearestAngle: null, audience: "", register: "essay" };
  try { mapping = await mapToThroughlines(brief, refCtx, ai); } catch (e) { console.warn("map failed", e); }

  // EXPAND — draft section by section
  const sections: string[] = [];
  for (let i = 0; i < brief.structure.length; i++) {
    if (onProgress) onProgress({ phase: "draft", i, total: brief.structure.length, name: brief.structure[i].section });
    try { sections.push(await draftSection(brief.structure[i], i, brief.structure.length, brief, mapping, extracts, refCtx, ai)); }
    catch (e) { console.warn("section failed", e); }
  }
  if (onProgress) onProgress({ phase: "done" });

  return {
    extracts, brief, mapping,
    draft: sections.filter(Boolean).join("\n\n"),
    generatedAt: Date.now(),
  };
}
