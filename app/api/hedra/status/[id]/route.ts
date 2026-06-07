import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, mediaJobs } from "@/lib/db";
import { getGenerationStatus, getAssetUrls } from "@/lib/hedra";
import { persistRemoteImage } from "@/lib/storage";
import { toErrorResponse } from "@/lib/errors";

// GET /api/hedra/status/[id]
// Authorizes the job to the current user (no cross-user reads), polls Hedra for
// the latest status, persists terminal/output fields, and returns the job.
// The client polls this on an interval and STOPS on completed/failed/canceled.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const job = await db.query.mediaJobs.findFirst({
      where: and(eq(mediaJobs.id, id), eq(mediaJobs.userId, user.id)),
    });
    if (!job) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

    // already terminal — no need to hit the provider again
    if (["completed", "failed", "canceled"].includes(job.status) || !job.hedraGenerationId) {
      return NextResponse.json({ job });
    }

    const s = await getGenerationStatus(job.hedraGenerationId);
    const terminal = ["completed", "failed", "canceled"].includes(s.status);

    // Hedra's status endpoint returns a null url for completed images/videos —
    // the rendered output lives on the asset. Resolve it on completion.
    let outUrl = s.url ?? undefined;
    let thumb = s.thumbnail_url ?? undefined;
    let dl = s.download_url ?? undefined;
    if (terminal && s.status === "completed" && !outUrl && s.asset_id) {
      try {
        const a = await getAssetUrls(s.asset_id, job.type === "image" ? "image" : "video");
        outUrl = a.url ?? outUrl;
        thumb = thumb ?? a.thumbnailUrl;
        dl = dl ?? a.url;
      } catch {
        /* asset lookup is best-effort; keep nulls */
      }
    }

    // Hedra's image URLs are signed CDN links that expire ~1h after issue, so a
    // stored URL goes 403 (broken image) before long. Download the rendered
    // image once and persist a permanent copy in our public bucket. Best-effort:
    // on any failure we keep the signed URL. (Videos still use the signed URL.)
    if (terminal && s.status === "completed" && job.type === "image" && outUrl) {
      const permanent = await persistRemoteImage(outUrl, job.id);
      if (permanent) {
        outUrl = permanent;
        dl = permanent;
        thumb = permanent;
      }
    }

    const [updated] = await db
      .update(mediaJobs)
      .set({
        status: (s.status as typeof mediaJobs.$inferInsert.status) ?? job.status,
        progress: s.progress != null ? Math.round(s.progress <= 1 ? s.progress * 100 : s.progress) : job.progress,
        outputUrl: outUrl ?? job.outputUrl,
        downloadUrl: dl ?? job.downloadUrl,
        thumbnailUrl: thumb ?? job.thumbnailUrl,
        hedraAssetId: s.asset_id ?? job.hedraAssetId,
        errorMessage: s.status === "failed" ? (s.error ?? "Generation failed.") : job.errorMessage,
        completedAt: terminal ? new Date() : job.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(mediaJobs.id, job.id))
      .returning();

    return NextResponse.json({ job: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
