# GATHER_BRIEF.md — the research connectors

Gather lets a user connect sources, run them, and curate the results into research items
that flow into Weave. It is **campaign-scoped** (each brand researches different things) and
every route is **user-authorized** (reuse `requireUser()`).

Front-end is built (`prototype-reference/gather.js` + `screen-gather.jsx`). Your job: make the
six connectors real and persist sources + items. Each connector must return the item shape
the UI already renders (see README). Set `demo: false` on real items.

## Connectors — how to implement each for real

> All fetching is **server-side** (that's the whole point — the browser can't, due to CORS +
> keys). Follow the `lib/hedra.ts` error pattern: a `GatherError(status, code, message)` with
> safe, secret-free messages; log detail server-side only.

### 1. RSS / News (`lib/gather/rss.ts`)
- No key. Server `fetch(feedUrl)` → parse XML (RSS 2.0 + Atom) with `fast-xml-parser`.
- Map entries → items (title, link→url, description→snippet, pubDate→date, author).
- Validate the URL (http/https), cap entries (e.g. 10), strip HTML from snippets.

### 2. Web search (`lib/gather/websearch.ts`)
- Needs a search provider. Pick one and set its key: **Brave Search API**
  (`BRAVE_SEARCH_API_KEY`), Bing, SerpAPI, or **Tavily** (`TAVILY_API_KEY`, nice for AI).
  The provided file targets Brave; swap if you prefer. Map results → items.

### 3. Database scrape (`lib/gather/scrape.ts`)
- Generic "fetch a page and extract the main text." Server fetch → `cheerio` (or
  `@mozilla/readability` + `jsdom`) → title + cleaned text snippet. Respect robots.txt and
  rate limits; this is intentionally conservative. For a specific structured DB, replace with
  that DB's API client.

### 4. Journal libraries (`lib/gather/journals.ts`)
- **Crossref** (`https://api.crossref.org/works?query=`) — no key (send a `mailto` in the
  User-Agent for the polite pool).
- **arXiv** (`http://export.arxiv.org/api/query`) — Atom feed, no key.
- **PubMed** E-utilities (`esearch` + `esummary`) — no key (optional `NCBI_API_KEY` for higher
  rate limits). 
- Query all three, merge, dedupe by DOI/title. Items carry real DOIs/URLs and authors.

### 5. X trending (`lib/gather/xtrends.ts`)
- X API v2 needs an app **bearer token** (`X_BEARER_TOKEN`); trends/search are on paid tiers.
- Use recent-search (`/2/tweets/search/recent?query=`) and/or trends; map top posts → items
  (text→snippet, author handle, created_at→date, permalink→url). Honor rate limits (429).

### 6. YouTube transcripts (`lib/gather/youtube.ts`)
- Parse the video id from the URL. Fetch the transcript with the `youtube-transcript` package
  (or the timedtext endpoint). Optionally fetch title/channel via YouTube Data API
  (`YOUTUBE_API_KEY`). Item: title, channel→source, full transcript in `transcript`, a short
  `snippet` summary, the watch URL. Handle "transcript disabled" gracefully.

## Registry + run

`lib/gather/index.ts` exposes `runConnector(kind, config)` dispatching to the right client,
and a `runGather(sources)` that runs enabled sources, persists items, and returns them.
Run sources concurrently with a small pool; partial failure must not fail the whole run
(skip the bad source, keep the rest) — mirror the prototype's `runGather`.

## Endpoints (`app/api/gather/`)
- `GET/POST /api/gather/sources`, `PATCH/DELETE /api/gather/sources/:id` — CRUD, user+campaign scoped.
- `POST /api/gather/run` — `{ campaignId }`: run that campaign's enabled sources, persist items, return them. Long runs → background job + `GET /api/gather/run/:jobId`.
- `GET /api/gather/items?campaignId=` / `DELETE /api/gather/items?id=` — list/remove.
- Send-to-Weave is a front-end action that calls the existing weave/pieces endpoints; no new route needed.

## Caching / freshness
Items can be re-fetched; treat external URLs as potentially transient. Store enough metadata to
re-query. De-dupe per (campaign, url) so repeated gathers don't pile up duplicates.

## Acceptance
- Each connector returns real items in the documented shape with `demo:false`.
- Keys live in server env only; never returned/logged. Provider errors map to safe messages
  (auth, rate_limit, validation, timeout, upstream).
- Sources + items persist per user+campaign; no cross-user/-campaign reads.
- The existing Gather UI works unchanged against `/api/gather/*`.
