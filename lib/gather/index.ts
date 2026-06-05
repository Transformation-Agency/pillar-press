/** Shared types + error + registry for Gather connectors. SERVER ONLY. */

export type SourceKind = "rss" | "web" | "database" | "journal" | "x" | "youtube";

/** Matches the item shape the front-end already renders (gather.js). */
export interface GatherItem {
  kind: SourceKind;
  sourceId?: string;
  sourceLabel?: string;
  title: string;
  source: string;        // publication / channel / site
  author?: string | null;
  date?: string;         // ISO or YYYY-MM
  url: string;
  snippet: string;
  transcript?: string | null;
  demo: false;           // real items are never demo
  raw?: unknown;         // provider payload (kept server-side / jsonb)
}

export class GatherError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "GatherError";
  }
}

export async function fetchText(url: string, init?: RequestInit, timeoutMs = 15000): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e: any) {
    if (e?.name === "TimeoutError") throw new GatherError(504, "timeout", "Source timed out.");
    throw new GatherError(502, "network", "Could not reach the source.");
  }
  if (!res.ok) throw new GatherError(res.status === 429 ? 429 : 502, res.status === 429 ? "rate_limit" : "upstream", `Source returned ${res.status}.`);
  return res.text();
}
export async function fetchJSON<T>(url: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  return JSON.parse(await fetchText(url, init, timeoutMs)) as T;
}

export function stripHtml(s = ""): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---- registry ----
import { runRss } from "./rss";
import { runWebSearch } from "./websearch";
import { runScrape } from "./scrape";
import { runJournals } from "./journals";
import { runXTrends } from "./xtrends";
import { runYouTube } from "./youtube";

// Dispatch via a switch (not a value-captured map): the connector modules and
// this barrel import each other circularly, so a `{ rss: runRss }` object can
// capture `undefined` when a connector is imported before this module. A switch
// resolves each binding at call time, which is circular-import safe.
export function runConnector(kind: SourceKind, config: string): Promise<GatherItem[]> {
  switch (kind) {
    case "rss": return runRss(config);
    case "web": return runWebSearch(config);
    case "database": return runScrape(config);
    case "journal": return runJournals(config);
    case "x": return runXTrends(config);
    case "youtube": return runYouTube(config);
    default: throw new GatherError(400, "bad_request", `Unknown source kind: ${kind}`);
  }
}

export interface SourceLike { id: string; kind: SourceKind; config: string; enabled: boolean; label?: string }

/** Run all enabled sources concurrently; partial failure skips that source. */
export async function runGather(sources: SourceLike[]): Promise<{ items: GatherItem[]; perSource: Record<string, number> }> {
  const enabled = sources.filter((s) => s.enabled && s.config?.trim());
  const perSource: Record<string, number> = {};
  const settled = await Promise.allSettled(
    enabled.map(async (s) => {
      const items = await runConnector(s.kind, s.config);
      return items.map((it) => ({ ...it, sourceId: s.id, sourceLabel: s.label }));
    }),
  );
  const items: GatherItem[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") { perSource[enabled[i].id] = r.value.length; items.push(...r.value); }
    else { perSource[enabled[i].id] = 0; console.warn(JSON.stringify({ level: "warn", msg: "gather source failed", sourceId: enabled[i].id, reason: (r.reason instanceof Error ? r.reason.message : String(r.reason)) })); }
  });
  return { items, perSource };
}
