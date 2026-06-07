import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, references } from "@/lib/db";
import { gatherSources, gatherItems } from "@/db/gather-schema";
import { runGather, type GatherItem } from "@/lib/gather";
import { runSchema, SOURCE_KIND_LABELS } from "@/lib/gather-validation";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { craftSourceSummary } from "@/lib/ai/gatherSummary";
import { toErrorResponse } from "@/lib/errors";

// Per-source LLM summaries can take a few seconds each (run concurrently).
export const maxDuration = 60;

interface SourceSummary {
  sourceId: string;
  kind: string;
  label: string | null;
  query: string;
  itemCount: number;
  text: string;
}

// POST /api/gather/run  { campaignId }
// Runs the campaign's enabled sources through the real connectors, persists the
// items (de-duped by url), then runs ONE independent LLM call per source to
// synthesize that source's fetched results into a research brief. Returns the
// saved items, per-source counts, and the per-source summaries.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { campaignId } = runSchema.parse(await req.json());

    const sources = await db.select().from(gatherSources)
      .where(and(eq(gatherSources.userId, user.id), eq(gatherSources.campaignId, campaignId)));

    const { items, perSource } = await runGather(sources as any);

    // update per-source run stats
    await Promise.all(
      Object.entries(perSource).map(([id, count]) =>
        db.update(gatherSources).set({ lastRun: new Date(), lastCount: count }).where(eq(gatherSources.id, id)),
      ),
    );

    // de-dupe against existing items for this campaign (by url)
    const existing = new Set(
      (await db.select({ url: gatherItems.url }).from(gatherItems)
        .where(and(eq(gatherItems.userId, user.id), eq(gatherItems.campaignId, campaignId))))
        .map((r) => r.url ?? ""),
    );
    const fresh = items.filter((it) => it.url && !existing.has(it.url));

    let saved: any[] = [];
    if (fresh.length) {
      saved = await db.insert(gatherItems).values(
        fresh.map((it) => ({
          userId: user.id, campaignId, sourceId: it.sourceId ?? null, kind: it.kind,
          title: it.title, source: it.source, author: it.author ?? null, url: it.url,
          publishedAt: it.date ?? null, snippet: it.snippet, transcript: it.transcript ?? null, raw: it.raw ?? null,
        })),
      ).returning();
    }

    // ---- per-source research summaries (one independent LLM call each) ----
    // Non-fatal: a summary failure must never lose the fetched items.
    let summaries: SourceSummary[] = [];
    let _summaryError: string | undefined;
    try {
      // Summarize ALL items found this run (not just newly-saved), grouped by source.
      const ref = await db.query.references.findFirst({ where: eq(references.campaignId, campaignId) });
      const refContext = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);

      const bySource = new Map<string, GatherItem[]>();
      for (const it of items) {
        const sid = it.sourceId ?? "_";
        const arr = bySource.get(sid) ?? [];
        arr.push(it);
        bySource.set(sid, arr);
      }
      const sourcesWithItems = sources.filter((s) => (bySource.get(s.id)?.length ?? 0) > 0);

      summaries = (
        await Promise.allSettled(
          sourcesWithItems.map(async (s): Promise<SourceSummary> => {
            const group = bySource.get(s.id) ?? [];
            const text = await craftSourceSummary({
              kindLabel: SOURCE_KIND_LABELS[s.kind] ?? s.kind,
              label: s.label ?? undefined,
              query: s.config ?? undefined,
              items: group,
              refContext,
            });
            return { sourceId: s.id, kind: s.kind, label: s.label ?? null, query: s.config ?? "", itemCount: group.length, text };
          }),
        )
      )
        .filter((r): r is PromiseFulfilledResult<SourceSummary> => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((s) => s.text);
    } catch (e) {
      _summaryError = (e as Error)?.message ?? String(e);
      console.error(JSON.stringify({ level: "error", msg: "gather summary block failed", detail: _summaryError }));
    }

    return NextResponse.json({ items: saved, found: items.length, saved: saved.length, perSource, summaries, _summaryError });
  } catch (err) { return toErrorResponse(err); }
}
