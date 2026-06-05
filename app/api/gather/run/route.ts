import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gatherSources, gatherItems } from "@/db/gather-schema";
import { runGather } from "@/lib/gather";
import { runSchema } from "@/lib/gather-validation";
import { toErrorResponse } from "@/lib/errors";

// POST /api/gather/run  { campaignId }
// Runs the campaign's enabled sources through the real connectors, persists the
// items (de-duped by url), updates per-source counts, and returns the items.
// For many/slow sources, move this to a background job + GET /run/[jobId].
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
    return NextResponse.json({ items: saved, found: items.length, saved: saved.length });
  } catch (err) { return toErrorResponse(err); }
}
