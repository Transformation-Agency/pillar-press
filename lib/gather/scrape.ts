/** Database / page scrape: fetch a URL and extract readable text. SERVER ONLY.
 *  For a specific structured DB, replace this with that DB's API client. */
import * as cheerio from "cheerio";
import { fetchText, GatherError, type GatherItem } from "./index";

export async function runScrape(input: string): Promise<GatherItem[]> {
  // input may be "https://site/page" or "https://site | what to look for"
  const url = input.split("|")[0].trim();
  if (!/^https?:\/\//i.test(url)) throw new GatherError(400, "bad_request", "Provide an http(s) URL to scrape.");
  const html = await fetchText(url, { headers: { "User-Agent": "KingsPress/1.0 (+gather)" } });
  const $ = cheerio.load(html);
  $("script,style,nav,footer,header,noscript").remove();
  const title = ($("title").first().text() || $("h1").first().text() || url).trim();
  const main = $("article").text() || $("main").text() || $("body").text();
  const text = main.replace(/\s+/g, " ").trim();
  // NOTE: respect robots.txt + rate limits for the target site before enabling broadly.
  return [{
    kind: "database",
    title: title.slice(0, 160),
    source: hostOf(url),
    author: null,
    date: "",
    url,
    snippet: text.slice(0, 500),
    demo: false,
    raw: { length: text.length },
  }];
}

function hostOf(u = ""): string { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "site"; } }
