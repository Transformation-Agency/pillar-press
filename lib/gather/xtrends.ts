/** X (Twitter) recent search / trends. Needs an app bearer token (paid tiers). SERVER ONLY. */
import { fetchJSON, GatherError, type GatherItem } from "./index";

export async function runXTrends(query: string, max = 5): Promise<GatherItem[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new GatherError(500, "config", "Missing X_BEARER_TOKEN.");
  // Recent search; for a #hashtag this surfaces the conversation. Trends use /2/trends.
  const q = query.startsWith("@") ? `from:${query.slice(1)}` : query;
  const url = `https://api.twitter.com/2/tweets/search/recent?max_results=${Math.max(10, max)}` +
    `&query=${encodeURIComponent(q + " -is:retweet")}` +
    `&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,name`;
  let json: any;
  try { json = await fetchJSON<any>(url, { headers: { Authorization: `Bearer ${token}` } }); }
  catch (e: any) { if (e?.code === "rate_limit") throw e; throw new GatherError(502, "upstream", "X request failed."); }

  const users: Record<string, any> = {};
  (json?.includes?.users ?? []).forEach((u: any) => (users[u.id] = u));
  return (json?.data ?? [])
    .sort((a: any, b: any) => (b.public_metrics?.like_count ?? 0) - (a.public_metrics?.like_count ?? 0))
    .slice(0, max)
    .map((t: any) => {
      const u = users[t.author_id];
      return {
        kind: "x" as const,
        title: (t.text ?? "").slice(0, 80),
        source: "X",
        author: u ? `@${u.username}` : null,
        date: t.created_at ? t.created_at.slice(0, 10) : "",
        url: u ? `https://x.com/${u.username}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`,
        snippet: t.text ?? "",
        demo: false as const,
        raw: t.public_metrics,
      };
    });
}
