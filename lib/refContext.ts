/**
 * refContext — VERBATIM port of prototype-reference/ai.js#refContext().
 *
 * Builds a compact reference-context block that the gates/generators read.
 * The output of buildRefContext MUST be BYTE-IDENTICAL to what ai.js produces
 * for the same references document (THROUGHLINES / Strategy note / AUDIENCES /
 * REGISTERS / CLARITY RULES / RED LINES / SELF-VISION blocks, in this exact
 * order, with the same punctuation, prefixes, and leading "\n" separators).
 *
 * The shape mirrors the references `doc` (see DATA_MODEL.md / SEED_REFERENCES
 * in lib/seed.ts). Every field is optional because the prototype guards each
 * block and each list with `|| []` / truthiness checks.
 */

export interface RefThroughline {
  tag: string;
  name: string;
  note: string;
}

export interface RefListItem {
  id: string;
  name: string;
  note: string;
}

export interface ReferencesDoc {
  strategy?: {
    throughlines?: readonly RefThroughline[];
    body?: string;
  };
  audiences?: {
    list?: readonly RefListItem[];
  };
  registers?: {
    list?: readonly RefListItem[];
    body?: string;
  };
  voiceRules?: {
    rules?: readonly string[];
  };
  redLines?: {
    rules?: readonly string[];
  };
  selfVision?: {
    body?: string;
  };
  // Other fields (title, gateSpec, etc.) may be present on the doc but are not
  // consumed by refContext(); they are intentionally ignored here.
  [key: string]: unknown;
}

/**
 * Port of ai.js `refContext(refs)`. Takes the references doc directly (the
 * server has no window.Store fallback) and returns the prompt-context string.
 */
export function buildRefContext(references?: ReferencesDoc | null): string {
  const r: ReferencesDoc = references || {};
  const lines: string[] = [];
  if (r.strategy) {
    lines.push("THROUGHLINES:");
    (r.strategy.throughlines || []).forEach((t) =>
      lines.push(`- [${t.tag}] ${t.name}: ${t.note}`),
    );
    if (r.strategy.body) lines.push("Strategy note: " + r.strategy.body);
  }
  if (r.audiences) {
    lines.push("\nAUDIENCES:");
    (r.audiences.list || []).forEach((a) =>
      lines.push(`- [${a.id}] ${a.name}: ${a.note}`),
    );
  }
  if (r.registers) {
    lines.push("\nREGISTERS:");
    (r.registers.list || []).forEach((x) =>
      lines.push(`- [${x.id}] ${x.name}: ${x.note}`),
    );
    if (r.registers.body) lines.push(r.registers.body);
  }
  if (r.voiceRules) {
    lines.push("\nCLARITY RULES:");
    (r.voiceRules.rules || []).forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  }
  if (r.redLines) {
    lines.push("\nRED LINES:");
    (r.redLines.rules || []).forEach((x) => lines.push(`- ${x}`));
  }
  if (r.selfVision && r.selfVision.body) {
    lines.push("\nSELF-VISION (public identity):\n" + r.selfVision.body);
  }
  return lines.join("\n");
}
