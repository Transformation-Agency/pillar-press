import { ai, type AI } from "@/lib/llm";

export interface SummaryItem {
  title: string;
  source?: string;
  author?: string | null;
  date?: string;
  url?: string;
  snippet?: string;
  transcript?: string | null;
}

export interface SummaryInput {
  kindLabel: string; // e.g. "Web search", "RSS / News feed"
  label?: string; // the source's own label
  query?: string; // the config (query or URL) the user entered
  items: SummaryItem[];
  refContext?: string;
}

const SYSTEM = `You are a research analyst for an author. You are given the REAL results one research connector just fetched (web results, news/RSS entries, academic papers, an X conversation, or a video transcript). Synthesize them into a tight, useful research brief the author can fold into their writing.

Rules:
- Use ONLY the material provided. Do NOT invent facts, quotes, statistics, or sources. If the material is thin, say so plainly.
- Open with a 1-2 sentence synthesis of what this batch of sources collectively shows.
- Then "## Key findings" — 3-6 bullets, each a concrete takeaway. Attribute each to its source by name, and include the source's URL in parentheses when present so links are preserved.
- Then "## Angles for the author" — 2-4 short bullets on how this could feed a piece, slanted to the author's focus if brand context is given.
- Be specific and concise. Markdown only. No preamble, no "Here is", no closing pleasantries.`;

/**
 * Synthesize one connector's fetched items into a research document (Markdown).
 * Pure + DB-free (the route does auth/persist); `client` is injectable for tests.
 */
export async function craftSourceSummary(input: SummaryInput, client: AI = ai): Promise<string> {
  const items = (input.items || []).filter((i) => i && (i.title || i.snippet || i.transcript));
  if (!items.length) return "";

  const itemsBlock = items
    .slice(0, 12)
    .map((it, i) => {
      const meta = [it.source, it.author, it.date].filter(Boolean).join(" · ");
      const body = (it.transcript || it.snippet || "").slice(0, 1200);
      return [
        `[${i + 1}] ${it.title || "Untitled"}`,
        meta && `    ${meta}`,
        it.url && `    URL: ${it.url}`,
        body && `    ${body}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const parts: string[] = [];
  if (input.refContext) parts.push(`AUTHOR FOCUS (bias the angles toward this):\n${input.refContext}`);
  parts.push(`CONNECTOR: ${input.kindLabel}${input.label ? ` — ${input.label}` : ""}`);
  if (input.query) parts.push(`QUERY / SOURCE: ${input.query}`);
  parts.push(`FETCHED RESULTS (${items.length}):\n${itemsBlock}`);
  parts.push("Write the research brief now.");

  const out = await client.complete([{ role: "user", content: parts.join("\n\n") }], SYSTEM);
  return (out || "").trim();
}
