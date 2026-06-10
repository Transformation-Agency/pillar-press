/** Journal libraries: Crossref + arXiv + PubMed. Mostly keyless. SERVER ONLY. */
import { XMLParser } from "fast-xml-parser";
import { fetchJSON, fetchText, stripHtml, type GatherItem } from "./index";

const MAILTO = process.env.GATHER_CONTACT_EMAIL ?? "research@kingspress.app";

export async function runJournals(query: string): Promise<GatherItem[]> {
  const [cr, ax, pm] = await Promise.allSettled([crossref(query), arxiv(query), pubmed(query)]);
  const items = [cr, ax, pm].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // de-dupe by lowercased title
  const seen = new Set<string>();
  return items.filter((i) => { const k = i.title.toLowerCase().slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
}

async function crossref(query: string, rows = 4): Promise<GatherItem[]> {
  const url = `https://api.crossref.org/works?rows=${rows}&query=${encodeURIComponent(query)}&mailto=${encodeURIComponent(MAILTO)}`;
  const json = await fetchJSON<any>(url, { headers: { "User-Agent": `KingsPress/1.0 (mailto:${MAILTO})` } });
  return (json?.message?.items ?? []).map((w: any) => ({
    kind: "journal" as const,
    title: (w.title?.[0] ?? "Untitled").trim(),
    source: w["container-title"]?.[0] ?? w.publisher ?? "Crossref",
    author: (w.author ?? []).slice(0, 3).map((a: any) => [a.given, a.family].filter(Boolean).join(" ")).join(", ") || null,
    date: (w.issued?.["date-parts"]?.[0] ?? []).slice(0, 2).join("-"),
    url: w.URL ?? (w.DOI ? `https://doi.org/${w.DOI}` : ""),
    snippet: stripHtml(w.abstract ?? "").slice(0, 400) || `${w.type ?? "work"} · ${w["is-referenced-by-count"] ?? 0} citations`,
    demo: false as const,
  }));
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
async function arxiv(query: string, max = 4): Promise<GatherItem[]> {
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${max}`;
  const doc = xml.parse(await fetchText(url));
  const entries = ([] as any[]).concat(doc?.feed?.entry ?? []);
  return entries.map((e) => ({
    kind: "journal" as const,
    title: stripHtml(e.title) || "Untitled",
    source: "arXiv",
    author: ([] as any[]).concat(e.author ?? []).slice(0, 3).map((a) => a.name).join(", ") || null,
    date: e.published ? String(e.published).slice(0, 10) : "",
    url: e.id ?? "",
    snippet: stripHtml(e.summary).slice(0, 400),
    demo: false as const,
  }));
}

async function pubmed(query: string, max = 4): Promise<GatherItem[]> {
  const key = process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "";
  const search = await fetchJSON<any>(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${max}&term=${encodeURIComponent(query)}${key}`);
  const ids: string[] = search?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const sum = await fetchJSON<any>(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}${key}`);
  return ids.map((id) => {
    const r = sum?.result?.[id]; if (!r) return null;
    return {
      kind: "journal" as const,
      title: r.title ?? "Untitled",
      source: r.fulljournalname ?? r.source ?? "PubMed",
      author: (r.authors ?? []).slice(0, 3).map((a: any) => a.name).join(", ") || null,
      date: r.pubdate ?? "",
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      snippet: `${r.fulljournalname ?? ""} ${r.pubdate ?? ""}`.trim(),
      demo: false as const,
    };
  }).filter(Boolean) as GatherItem[];
}
