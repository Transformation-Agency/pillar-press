import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, mediaJobs } from "@/lib/db";
import { getAssetUrls } from "@/lib/hedra";
import { persistRemoteImage, persistRemoteVideo, isStoredUrl, storageConfigured } from "@/lib/storage";
import { toErrorResponse } from "@/lib/errors";

export const maxDuration = 60;

/**
 * POST /api/admin/reseal-images  (behind site Basic Auth)
 *
 * One-off backfill: Hedra hands out signed CDN URLs that expire ~1h after issue,
 * so older completed media now 403 (broken). For each completed item not yet in
 * our public bucket, re-resolve a FRESH signed URL from Hedra (it re-signs on
 * demand), download it, and persist a permanent copy — then point the row at it.
 * Idempotent: already-stored rows are skipped.
 *
 * ?type=image (default) | video — video covers both video and avatar_video.
 * Batched via ?limit=N (default 6); call repeatedly until { remaining: 0 }.
 */
export async function POST(req: Request) {
  try {
    if (!storageConfigured()) {
      return NextResponse.json({ error: "Storage not configured.", code: "config" }, { status: 500 });
    }
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "6", 10) || 6, 1), 20);
    const kind = url.searchParams.get("type") === "video" ? "video" : "image";
    const jobTypes = kind === "video" ? (["video", "avatar_video"] as const) : (["image"] as const);
    const assetType = kind === "video" ? "video" : "image";

    const rows = await db.query.mediaJobs.findMany({
      where: and(inArray(mediaJobs.type, [...jobTypes]), eq(mediaJobs.status, "completed")),
    });

    const pending = rows.filter((m) => !isStoredUrl(m.outputUrl));
    const batch = pending.slice(0, limit);

    let resealed = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const m of batch) {
      // Prefer a freshly re-signed URL from the asset; fall back to the stored one.
      let fresh: string | undefined = m.outputUrl ?? undefined;
      if (m.hedraAssetId) {
        try {
          const a = await getAssetUrls(m.hedraAssetId, assetType);
          if (a.url) fresh = a.url;
        } catch {
          /* keep stored url */
        }
      }
      const permanent = fresh
        ? kind === "video"
          ? await persistRemoteVideo(fresh, m.id)
          : await persistRemoteImage(fresh, m.id)
        : null;
      if (!permanent) {
        failed++;
        failures.push(m.id);
        continue;
      }
      const set: Partial<typeof mediaJobs.$inferInsert> = {
        outputUrl: permanent,
        downloadUrl: permanent,
        updatedAt: new Date(),
      };
      // For images the rendered output IS the thumbnail; for video keep the poster.
      if (kind === "image") set.thumbnailUrl = permanent;
      await db.update(mediaJobs).set(set).where(eq(mediaJobs.id, m.id));
      resealed++;
    }

    return NextResponse.json({
      kind,
      total: rows.length,
      alreadyStored: rows.length - pending.length,
      processed: batch.length,
      resealed,
      failed,
      failures,
      remaining: pending.length - batch.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
