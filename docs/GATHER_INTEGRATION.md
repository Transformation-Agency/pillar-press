# INTEGRATION.md — where files go + the front-end swap

## Drop these into the prior `claude-code-backend` tree

| This update | Lands at (in your Next.js app) |
|---|---|
| `lib/gather/*` | `lib/gather/*` |
| `lib/gather-validation.ts` | `lib/gather-validation.ts` |
| `db/gather-schema.ts` | `db/gather-schema.ts` (export its tables from your Drizzle schema barrel) |
| `db/gather-migration.sql` | run via your migration tool |
| `app/api/gather/**` | `app/api/gather/**` |
| `__tests__/gather.test.ts` | `__tests__/gather.test.ts` |
| `.env.additions` | append to `.env` / Vercel env |

Reuses unchanged from the prior package: `lib/auth.ts` (`requireUser`), `lib/db.ts` (`db`),
`lib/errors.ts` (`toErrorResponse`). Install deps: `npm i fast-xml-parser cheerio youtube-transcript`.

## Front-end swap (in `gather.js`)

The prototype simulates the run. Replace `runGather` with calls to your API — the item shape
is identical, so `screen-gather.jsx` needs no changes:

```js
// was: ask the model for demo items
// now: real connectors, server-side
async function runGather(sources, _refCtx, onProgress) {
  const campaignId = window.Store.getState().activeCampaignId;
  if (onProgress) onProgress({ label: "all sources", i: 0, total: sources.length });
  const res = await fetch("/api/gather/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaignId }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Gather failed.");
  const { items } = await res.json();
  if (onProgress) onProgress({ done: true });
  // items already persisted server-side; mirror into the store for the UI:
  window.Store.addGatherItems(items.map((i) => ({ ...i, demo: false })));
  return items;
}
```

Likewise move source CRUD (`addGatherSource`/`updateGatherSource`/`removeGatherSource`) to
`/api/gather/sources`, and load items from `/api/gather/items?campaignId=` on mount.
Send-to-Weave is unchanged (it calls the existing weave/pieces flow).
