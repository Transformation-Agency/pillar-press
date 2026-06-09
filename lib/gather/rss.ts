/** RSS 2.0 + Atom feed connector. No API key. SERVER ONLY. */
import { XMLParser } from "fast-xml-parser";
import { fetchText, stripHtml, GatherError, type GatherItem } from "./index";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export async function runRss(feedUrl: string, max = 10): Promise<GatherItem[]> {
  if (!/^https?:\/\//i.test(feedUrl)) throw new GatherError(400, "bad_request", "Feed URL must be http(s).");
  const xml = await fetchText(feedUrl, { headers: { "User-Agent": "KingsPress/1.0 (+gather)" } });
  const doc = parser.parse(xml);

  // RSS 2.0
  const channel = doc?.rss?.channel;
  if (channel) {
    const feedTitle = channel.title ?? "RSS";
    const entries = ([] as any[]).concat(channel.item ?? []);
    return entries.slice(0, max).map((e) => item({
      title: e.title, url: e.link, snippet: e.description ?? e["content:encoded"],
      date: e.pubDate, author: e["dc:creator"] ?? e.author, source: feedTitle,
    }));
  }
  // Atom
  const feed = doc?.feed;
  if (feed) {
    const feedTitle = feed.title ?? "Atom";
    const entries = ([] as any[]).concat(feed.entry ?? []);
    return entries.slice(0, max).map((e) => item({
      title: e.title, url: linkOf(e.link), snippet: e.summary ?? e.content,
      date: e.updated ?? e.published, author: e.author?.name, source: feedTitle,
    }));
  }
  throw new GatherError(422, "validation", "Could not parse this feed as RSS or Atom.");
}

function linkOf(link: any): string {
  if (Array.isArray(link)) return (link.find((l) => l["@_rel"] === "alternate") ?? link[0])?.["@_href"] ?? "";
  return link?.["@_href"] ?? link ?? "";
}
function text(v: any): string { return typeof v === "object" ? (v?.["#text"] ?? "") : (v ?? ""); }
function item(o: any): GatherItem {
  return {
    kind: "rss",
    title: stripHtml(text(o.title)) || "Untitled",
    url: text(o.url) || "",
    snippet: stripHtml(text(o.snippet)).slice(0, 400),
    date: o.date ? new Date(text(o.date)).toISOString().slice(0, 10) : "",
    author: o.author ? stripHtml(text(o.author)) : null,
    source: stripHtml(text(o.source)) || "RSS",
    demo: false,
  };
}
