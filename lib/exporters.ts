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

/* ============================================================
 * Book Writer — assemble a campaign's pieces (chapters) into one
 * Markdown manuscript. Pure helpers (no db/auth/fetch), consumed by
 * app/api/campaigns/[id]/book/export/route.ts and unit-tested directly.
 *
 * Mental model: campaign = book, piece = chapter. Nothing here changes
 * the editorial pipeline — it only reads already-saved chapter text.
 * ============================================================ */

/** Minimal shape of a piece needed to render it as a book chapter. */
export interface BookChapter {
  title: string;
  original?: string | null;
  revision?: { text?: string | null } | null;
  createdAt?: string | number | Date | null;
}

const tsOf = (v: string | number | Date | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : +new Date(v);

/**
 * Parse a chapter number from a title, or null when there is none. VERBATIM
 * port of `screen-book.jsx#chapterNum`: a leading number ("01 …") wins, else a
 * "Chapter N" / "Ch. N" / "Part N" anywhere in the title.
 */
export function chapterLeadingNumber(title: string): number | null {
  const t = String(title || "");
  const lead = t.match(/^\s*0*(\d{1,3})\b/);
  if (lead) return parseInt(lead[1], 10);
  const ch = t.match(/\b(?:chapter|ch\.?|part)\s+0*(\d{1,3})\b/i);
  if (ch) return parseInt(ch[1], 10);
  return null;
}

/**
 * The canonical text for a chapter. VERBATIM port of
 * `exporters.js#bookMarkdown` text rule: the saved draft (`original`) is the
 * source of truth — the UI's "Accept Revision" writes revision.text into it —
 * with the proposed revision used ONLY as a fallback when the draft is empty.
 */
export function chapterText(chapter: BookChapter): string {
  return chapter.original && chapter.original.trim()
    ? (chapter.original as string)
    : (chapter.revision && chapter.revision.text) || "";
}

/**
 * Order chapters for the book. VERBATIM port of `screen-book.jsx#sortChapters`:
 * numbered titles first (ascending, createdAt breaks ties), then un-numbered
 * chapters by createdAt. Keeps the server export order identical to the order
 * the user sees in the Book Writer chapter list.
 */
export function sortChaptersForBook<T extends BookChapter>(chapters: T[]): T[] {
  return (chapters || []).slice().sort((a, b) => {
    const na = chapterLeadingNumber(a.title);
    const nb = chapterLeadingNumber(b.title);
    if (na != null && nb != null) return na - nb || tsOf(a.createdAt) - tsOf(b.createdAt);
    if (na != null) return -1;
    if (nb != null) return 1;
    return tsOf(a.createdAt) - tsOf(b.createdAt);
  });
}

/**
 * Assemble a book's Markdown from its (already-ordered) chapters. VERBATIM port
 * of `exporters.js#bookMarkdown(campaign, chapters)` so the server route and the
 * client download produce a byte-identical document:
 *
 *   # Book Title
 *
 *   ## Chapter 1 Title
 *
 *   Chapter text...
 *
 *   ---
 *
 *   ## Chapter 2 Title
 *   ...
 */
export function bookMarkdown(input: { title: string; chapters: BookChapter[] }): string {
  const title = input.title || "Untitled book";
  const L: string[] = [`# ${title}`, ""];
  (input.chapters || []).forEach((c, i) => {
    const text = chapterText(c);
    if (i > 0) L.push("", "---", "");
    L.push(`## ${c.title || "Chapter " + (i + 1)}`, "", text, "");
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
