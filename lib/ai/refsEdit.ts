import { ai, extractJSON, repairJSON, type AI } from "@/lib/llm";
import type { ReferencesDoc } from "@/lib/refContext";

export interface RefsEditInput {
  doc: ReferencesDoc;
  instruction: string;
}
export interface RefsEditResult {
  doc: ReferencesDoc;
  summary: string;
  ok: boolean; // false when the model output couldn't be parsed into a usable doc
}

const SYSTEM = `You are a brand & editorial strategist editing an author's REFERENCES document — the source of truth every AI gate, revision, and generator reads. Apply the author's instruction precisely while preserving their voice and intent. Change only what the instruction asks for (plus obvious consistency fixes it implies); leave everything else exactly as written.

The document is JSON with this EXACT shape (keep every key present):
{
 "strategy": { "throughlines": [{"tag":"kebab-id","name":"Title","note":"1-2 sentences"}], "body":"string" },
 "audiences": { "list": [{"id":"kebab-id","name":"Name","note":"who they are"}] },
 "registers": { "list": [{"id":"kebab-id","name":"Name","note":"how it sounds"}], "body":"string" },
 "voiceRules": { "rules": ["string", ...] },
 "redLines": { "rules": ["string", ...] },
 "selfVision": { "body":"string" },
 "gateSpec": { "body":"string" }
}

Rules:
- Return ONLY the sections you actually changed. OMIT unchanged sections entirely — they are preserved automatically. (This keeps the response small.)
- Within any section you change, include its COMPLETE new value. E.g. if you edit the audiences list, return the FULL updated list (every entry you want to keep), not just the new one — anything omitted from a returned list is dropped.
- Preserve the author's exact wording wherever the instruction doesn't call for a change.
- tag / id values are stable identifiers — keep them unless explicitly asked to change them; prefer editing names/notes or adding new entries.
- Keep notes concise and in the author's register. No markdown inside string values.
- CRITICAL: never put a double-quote character inside any string value — if you must quote a phrase, use single quotes ('). Never put raw line breaks inside a string; write a normal paragraph. Emit strict, valid JSON.

Return ONLY JSON: {"doc": <the changed sections>, "summary": "<one or two plain sentences describing what you changed>"}`;

/**
 * Tolerant JSON parse for model output. Models often echo the doc's long
 * multi-line bodies with RAW newlines/tabs inside string values — which is
 * invalid JSON. Strip code fences, then escape control chars that occur inside
 * string literals before parsing (and trim any trailing junk).
 */
function lenientJSON<T = unknown>(text: string): T | null {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const start = t.search(/[{[]/);
  if (start < 0) return null;
  t = t.slice(start);
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') {
        // A real closing quote is followed (past whitespace) by a structural
        // char; otherwise it's an UNescaped inner quote the model emitted — fix it.
        let j = i + 1;
        while (j < t.length && /\s/.test(t[j])) j++;
        const nxt = t[j];
        if (nxt === undefined || nxt === "," || nxt === ":" || nxt === "}" || nxt === "]") { out += '"'; inStr = false; }
        else { out += '\\"'; }
        continue;
      }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    } else {
      if (ch === '"') { inStr = true; }
      out += ch;
    }
  }
  try { return JSON.parse(out) as T; } catch { /* try trimming trailing junk */ }
  const last = Math.max(out.lastIndexOf("}"), out.lastIndexOf("]"));
  if (last > 0) { try { return JSON.parse(out.slice(0, last + 1)) as T; } catch { /* give up */ } }
  return null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) as string[] : undefined;
const entryList = (v: unknown, idKey: "tag" | "id") =>
  Array.isArray(v)
    ? v
        .filter((e) => e && typeof e === "object")
        .map((e) => {
          const o = e as Record<string, unknown>;
          return { [idKey]: str(o[idKey]), name: str(o.name), note: str(o.note) };
        })
        .filter((e) => (e as Record<string, string>).name || (e as Record<string, string>).note)
    : undefined;

/**
 * Merge the model's proposed doc over the original, accepting a section only when
 * it is shape-valid — so a malformed/partial AI response can never corrupt the
 * references. Unspecified sections keep their original value.
 */
function sanitizeDoc(raw: unknown, original: ReferencesDoc): ReferencesDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const o = (original || {}) as Record<string, any>;
  const pick = <T>(next: T | undefined, prev: T): T => (next === undefined ? prev : next);
  return {
    strategy: {
      throughlines: pick(entryList(r.strategy?.throughlines, "tag") as any, o.strategy?.throughlines ?? []),
      body: pick(r.strategy && typeof r.strategy.body === "string" ? r.strategy.body : undefined, o.strategy?.body ?? ""),
    },
    audiences: { list: pick(entryList(r.audiences?.list, "id") as any, o.audiences?.list ?? []) },
    registers: {
      list: pick(entryList(r.registers?.list, "id") as any, o.registers?.list ?? []),
      body: pick(r.registers && typeof r.registers.body === "string" ? r.registers.body : undefined, o.registers?.body ?? ""),
    },
    voiceRules: { rules: pick(strList(r.voiceRules?.rules), o.voiceRules?.rules ?? []) },
    redLines: { rules: pick(strList(r.redLines?.rules), o.redLines?.rules ?? []) },
    selfVision: { body: pick(typeof r.selfVision?.body === "string" ? r.selfVision.body : undefined, o.selfVision?.body ?? "") },
    gateSpec: { body: pick(typeof r.gateSpec?.body === "string" ? r.gateSpec.body : undefined, o.gateSpec?.body ?? "") },
  } as ReferencesDoc;
}

/** Apply a natural-language instruction to the references document via AI. */
export async function craftReferencesEdit(input: RefsEditInput, client: AI = ai): Promise<RefsEditResult> {
  const prompt = `CURRENT REFERENCES DOCUMENT:\n${JSON.stringify(input.doc ?? {}, null, 2)}\n\nAUTHOR INSTRUCTION:\n${input.instruction}\n\nReturn the full updated document and a summary as JSON.`;
  const out = await client.complete([{ role: "user", content: prompt }], SYSTEM);
  const parsed = (lenientJSON<Record<string, unknown>>(out) ?? extractJSON<Record<string, unknown>>(out) ?? repairJSON<Record<string, unknown>>(out) ?? {}) as Record<string, unknown>;
  // Accept either { doc, summary } or a bare changed-sections object.
  const SECTIONS = ["strategy", "audiences", "registers", "voiceRules", "redLines", "selfVision", "gateSpec"];
  const hasWrapper = "doc" in parsed && parsed.doc && typeof parsed.doc === "object";
  const rawDoc = hasWrapper ? (parsed.doc as unknown) : (SECTIONS.some((k) => k in parsed) ? parsed : undefined);
  return {
    doc: sanitizeDoc(rawDoc, input.doc),
    summary: str(parsed.summary) || "Updated the references.",
    ok: !!rawDoc,
  };
}
