/** YouTube transcript connector. Transcript via `youtube-transcript`; optional
 *  title/channel via YouTube Data API. SERVER ONLY. */
import { YoutubeTranscript } from "youtube-transcript";
import { fetchJSON, GatherError, type GatherItem } from "./index";

export async function runYouTube(input: string): Promise<GatherItem[]> {
  const id = parseId(input);
  if (!id) throw new GatherError(400, "bad_request", "Could not read a YouTube video id from that URL.");

  let segments;
  try { segments = await YoutubeTranscript.fetchTranscript(id); }
  catch { throw new GatherError(422, "validation", "No transcript available for this video (it may be disabled)."); }
  const transcript = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();

  let title = `YouTube video ${id}`, channel = "YouTube", date = "";
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    try {
      const meta = await fetchJSON<any>(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}&key=${key}`);
      const sn = meta?.items?.[0]?.snippet;
      if (sn) { title = sn.title; channel = sn.channelTitle; date = (sn.publishedAt ?? "").slice(0, 10); }
    } catch { /* metadata is best-effort */ }
  }

  return [{
    kind: "youtube",
    title,
    source: channel,
    author: channel,
    date,
    url: `https://www.youtube.com/watch?v=${id}`,
    snippet: transcript.slice(0, 280) + (transcript.length > 280 ? "…" : ""),
    transcript,
    demo: false,
  }];
}

function parseId(input: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();
  const m = input.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
