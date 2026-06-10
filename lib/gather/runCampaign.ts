import { and, eq } from "drizzle-orm";
import { db, references } from "@/lib/db";
import { gatherSources, gatherItems } from "@/db/gather-schema";
import {
  createLocalGatherItem,
  existingLocalGatherItemUrls,
  getLocalReferences,
  listLocalGatherSources,
  updateLocalGatherSource,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { runGather, type GatherItem } from "@/lib/gather";
import { SOURCE_KIND_LABELS } from "@/lib/gather-validation";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { craftSourceSummary } from "@/lib/ai/gatherSummary";
import { getAIForTask } from "@/lib/llm";

interface SourceSummary {
  sourceId: string;
  kind: string;
  label: string | null;
  query: string;
  itemCount: number;
  text: string;
}

export async function runGatherForCampaign(campaignId: string, user: { id: string; workspaceId?: string | null }) {
  const sources = isLocalFirstMode()
    ? listLocalGatherSources(campaignId, user.id, user.workspaceId || undefined)
    : await db.select().from(gatherSources)
        .where(and(eq(gatherSources.userId, user.id), eq(gatherSources.campaignId, campaignId)));
  if (!sources) return null;

  const { items, perSource } = await runGather(sources as any);

  if (isLocalFirstMode()) {
    Object.entries(perSource).forEach(([id, count]) =>
      updateLocalGatherSource(id, user.id, { lastRun: new Date().toISOString(), lastCount: count }),
    );
  } else {
    await Promise.all(
      Object.entries(perSource).map(([id, count]) =>
        db.update(gatherSources).set({ lastRun: new Date(), lastCount: count }).where(eq(gatherSources.id, id)),
      ),
    );
  }

  const existing = isLocalFirstMode()
    ? existingLocalGatherItemUrls(campaignId, user.id)
    : new Set(
        (await db.select({ url: gatherItems.url }).from(gatherItems)
          .where(and(eq(gatherItems.userId, user.id), eq(gatherItems.campaignId, campaignId))))
          .map((r) => r.url ?? ""),
      );
  const fresh = items.filter((it) => it.url && !existing.has(it.url));

  let saved: any[] = [];
  if (fresh.length) {
    if (isLocalFirstMode()) {
      saved = fresh
        .map((it) => createLocalGatherItem({
          campaignId,
          sourceId: it.sourceId ?? null,
          kind: it.kind,
          title: it.title,
          source: it.source,
          author: it.author ?? null,
          url: it.url,
          publishedAt: it.date ?? null,
          snippet: it.snippet,
          transcript: it.transcript ?? null,
          raw: it.raw ?? null,
        }, user.id, user.workspaceId || undefined))
        .filter(Boolean);
    } else {
      saved = await db.insert(gatherItems).values(
        fresh.map((it) => ({
          userId: user.id, campaignId, sourceId: it.sourceId ?? null, kind: it.kind,
          title: it.title, source: it.source, author: it.author ?? null, url: it.url,
          publishedAt: it.date ?? null, snippet: it.snippet, transcript: it.transcript ?? null, raw: it.raw ?? null,
        })),
      ).returning();
    }
  }

  let summaries: SourceSummary[] = [];
  try {
    const ref = isLocalFirstMode()
      ? getLocalReferences(campaignId, user.workspaceId || undefined)
      : await db.query.references.findFirst({ where: eq(references.campaignId, campaignId) });
    const refContext = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);

    const bySource = new Map<string, GatherItem[]>();
    for (const it of items) {
      const sid = it.sourceId ?? "_";
      const arr = bySource.get(sid) ?? [];
      arr.push(it);
      bySource.set(sid, arr);
    }
    const sourcesWithItems = sources.filter((s) => (bySource.get(s.id)?.length ?? 0) > 0);

    const gatherAI = getAIForTask("gather");
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
          }, gatherAI);
          if (text) {
            if (isLocalFirstMode()) {
              updateLocalGatherSource(s.id, user.id, {
                summary: text,
                summaryAt: new Date().toISOString(),
                summaryItemCount: group.length,
              });
            } else {
              await db
                .update(gatherSources)
                .set({ summary: text, summaryAt: new Date(), summaryItemCount: group.length })
                .where(eq(gatherSources.id, s.id));
            }
          }
          return { sourceId: s.id, kind: s.kind, label: s.label ?? null, query: s.config ?? "", itemCount: group.length, text };
        }),
      )
    )
      .filter((r): r is PromiseFulfilledResult<SourceSummary> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((s) => s.text);
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "gather summary block failed", detail: (e as Error)?.message ?? String(e) }));
  }

  return { items: saved, found: items.length, saved: saved.length, perSource, summaries };
}
