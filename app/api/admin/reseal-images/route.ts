import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, mediaJobs } from "@/lib/db";
import { getAssetUrls } from "@/lib/hedra";
import { persistRemoteImage, isStoredUrl, storageConfigured } from "@/lib/storage";
import { toErrorResponse } from "@/lib/errors";

export const maxDuration = 60;

/**
 * POST /api/admin/reseal-images  (behind site Basic Auth)
 *
 * One-off backfill: Hedra hands out signed CDN image URLs that expire ~1h after
 * issue, so older completed images now 403 (broken). For each completed image
 * not yet in our public bucket, re-resolve a FRESH signed URL from Hedra (it
 * re-signs on demand), download it, and persist a permanent copy — then point
 * the row at it. Idempotent: already-stored rows are skipped.
 *
 * Batched via ?limit=N (default 6) so it stays under the function time limit;
 * call repeatedly until { remaining: 0 }.
 */
export async function POST(req: Request) {
  try {
    if (!storageConfigured()) {
      return NextResponse.json({ error: "Storage not configured.", code: "config" }, { status: 500 });
    }
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "6", 10) || 6, 1), 20);

    const rows = await db.query.mediaJobs.findMany({
      where: and(eq(mediaJobs.type, "image"), eq(mediaJobs.status, "completed")),
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
          const a = await getAssetUrls(m.hedraAssetId, "image");
          if (a.url) fresh = a.url;
        } catch {
          /* keep stored url */
        }
      }
      const permanent = fresh ? await persistRemoteImage(fresh, m.id) : null;
      if (!permanent) {
        failed++;
        failures.push(m.id);
        continue;
      }
      await db
        .update(mediaJobs)
        .set({ outputUrl: permanent, downloadUrl: permanent, thumbnailUrl: permanent, updatedAt: new Date() })
        .where(eq(mediaJobs.id, m.id));
      resealed++;
    }

    return NextResponse.json({
      totalImages: rows.length,
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
