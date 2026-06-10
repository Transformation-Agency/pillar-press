/** Web search via Brave Search API (swap provider as you like). SERVER ONLY. */
import { fetchJSON, stripHtml, GatherError, type GatherItem } from "./index";

export async function runWebSearch(query: string, count = 5): Promise<GatherItem[]> {
  // Keep legacy env names as compatibility fallbacks for existing hosted
  // installs, but prefer provider-neutral / King’s Press names.
  const key = process.env.BRAVE_SEARCH_API_KEY || process.env.Brave_Kings_Press || process.env.Brave_Pillar_Press;
  if (!key) throw new GatherError(500, "config", "Missing BRAVE_SEARCH_API_KEY (or wire a different search provider).");
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const json = await fetchJSON<any>(url, { headers: { Accept: "application/json", "X-Subscription-Token": key } });
  return (json?.web?.results ?? []).slice(0, count).map((r: any) => ({
    kind: "web" as const,
    title: stripHtml(r.title) || "Result",
    source: r.profile?.name ?? hostOf(r.url),
    author: null,
    date: r.age ?? r.page_age ?? "",
    url: r.url,
    snippet: stripHtml(r.description ?? "").slice(0, 400),
    demo: false as const,
  }));
}

function hostOf(u = ""): string { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "web"; } }
