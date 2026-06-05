/**
 * Exporters (Unit U4.2) — server port of the markdown builders from
 * `prototype-reference/exporters.js`. The markdown STRUCTURE is reproduced
 * VERBATIM from the prototype so downloaded files and Drive uploads are
 * byte-for-byte the same document the client `.md`/`.zip` path produces.
 *
 * Only the pure markdown builders are ported here. The browser-only concerns
 * (Blob/download/ZIP) stay client-side — see `exporters.js#zipBlob` /
 * `downloadText`; the server has no need for them and Drive uploads send the
 * raw markdown text directly.
 *
 * These functions are PURE: no db, no auth, no fetch. They are trivially
 * unit-testable and are consumed by app/api/drive/upload/route.ts.
 */

/** One platform output, as stored in `piece.outputs[platformId]`. */
export interface OutputObject {
  platform: string;
  selectedAudience: string;
  throughlineTag: string;
  strategicPurpose: string;
  draftPost: string;
  hooks?: string[];
  ctas?: string[];
  mediaRec: string;
  riskCheck: string;
  relatedOffering: string;
  followUp: string;
}

/** Minimal shape of a piece needed to render its outputs. */
export interface PieceForExport {
  title: string;
  outputs: Record<string, OutputObject>;
  outputOrder?: string[];
}

/**
 * outputMarkdown — VERBATIM port of `exporters.js#outputMarkdown(o)`.
 * Produces the per-platform markdown document.
 */
export function outputMarkdown(o: OutputObject): string {
  const L: string[] = [];
  L.push(`# ${o.platform}`);
  L.push("");
  L.push(`- **Audience:** ${o.selectedAudience}`);
  L.push(`- **Throughline:** #${o.throughlineTag}`);
  L.push(`- **Strategic purpose:** ${o.strategicPurpose}`);
  L.push("");
  L.push(`## Post`);
  L.push("");
  L.push(o.draftPost || "");
  L.push("");
  L.push(`## Hook options`);
  (o.hooks || []).forEach((h) => L.push(`- ${h}`));
  L.push("");
  L.push(`## CTA options`);
  (o.ctas || []).forEach((c) => L.push(`- ${c}`));
  L.push("");
  L.push(`## Production`);
  L.push(`- **Imagery / media:** ${o.mediaRec}`);
  L.push(`- **Risk & boundary:** ${o.riskCheck}`);
  L.push(`- **Related offering:** ${o.relatedOffering}`);
  L.push(`- **Suggested follow-up:** ${o.followUp}`);
  L.push("");
  return L.join("\n");
}

/**
 * pieceOutputsMarkdown — VERBATIM port of `exporters.js#pieceOutputsMarkdown`.
 * Concatenates every output in `outputOrder` into one document.
 */
export function pieceOutputsMarkdown(piece: PieceForExport): string {
  const L: string[] = [`# ${piece.title} — Platform outputs`, ""];
  (piece.outputOrder || []).forEach((pid) => {
    const o = piece.outputs[pid];
    if (!o) return;
    L.push("---", "", outputMarkdown(o), "");
  });
  return L.join("\n");
}

/**
 * safeName — VERBATIM port of `exporters.js#safeName`. Used to derive Drive
 * filenames from titles / platform names.
 */
export function safeName(s: string): string {
  return (
    (s || "untitled")
      .replace(/[^a-z0-9\-_ ]/gi, "")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "untitled"
  );
}
