import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, mediaJobs } from "@/lib/db";
import { getLocalMediaJob, updateLocalMediaJob } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { getGenerationStatus, getAssetUrls } from "@/lib/hedra";
import { persistRemoteImage, persistRemoteVideo } from "@/lib/storage";
import { toErrorResponse } from "@/lib/errors";

// Downloading + re-uploading a rendered video can take a while.
export const maxDuration = 60;

// GET /api/hedra/status/[id]
// Authorizes the job to the current user (no cross-user reads), polls Hedra for
// the latest status, persists terminal/output fields, and returns the job.
// The client polls this on an interval and STOPS on completed/failed/canceled.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const job = isLocalFirstMode()
      ? getLocalMediaJob(id, user.id)
      : await db.query.mediaJobs.findFirst({
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

    // Hedra's asset URLs are signed CDN links that expire ~1h after issue, so a
    // stored URL goes 403 (broken media) before long. Download the rendered
    // output once and persist a permanent copy in our public bucket. Best-effort:
    // on any failure we keep the signed URL.
    if (terminal && s.status === "completed" && outUrl) {
      if (job.type === "image") {
        const permanent = await persistRemoteImage(outUrl, job.id);
        if (permanent) {
          outUrl = permanent;
          dl = permanent;
          thumb = permanent;
        }
      } else {
        // video / avatar_video: persist the clip, and the poster (a signed
        // image URL that also expires) so it keeps showing before playback.
        const permanent = await persistRemoteVideo(outUrl, job.id);
        if (permanent) {
          outUrl = permanent;
          dl = permanent;
        }
        if (thumb) {
          const poster = await persistRemoteImage(thumb, `${job.id}-poster`);
          if (poster) thumb = poster;
        }
      }
    }

    if (isLocalFirstMode()) {
      const localCompletedAt =
        typeof job.completedAt === "string"
          ? job.completedAt
          : job.completedAt
            ? job.completedAt.toISOString()
            : null;
      const updated = updateLocalMediaJob(job.id, user.id, {
        status: (s.status as any) ?? job.status,
        progress: s.progress != null ? Math.round(s.progress <= 1 ? s.progress * 100 : s.progress) : job.progress,
        outputUrl: outUrl ?? job.outputUrl,
        downloadUrl: dl ?? job.downloadUrl,
        thumbnailUrl: thumb ?? job.thumbnailUrl,
        hedraAssetId: s.asset_id ?? job.hedraAssetId,
        errorMessage: s.status === "failed" ? (s.error ?? "Generation failed.") : job.errorMessage,
        completedAt: terminal ? new Date().toISOString() : localCompletedAt,
      });
      return NextResponse.json({ job: updated });
    }

    const dbJob = job as typeof mediaJobs.$inferSelect;
    const [updated] = await db
      .update(mediaJobs)
      .set({
        status: (s.status as typeof mediaJobs.$inferInsert.status) ?? dbJob.status,
        progress: s.progress != null ? Math.round(s.progress <= 1 ? s.progress * 100 : s.progress) : dbJob.progress,
        outputUrl: outUrl ?? dbJob.outputUrl,
        downloadUrl: dl ?? dbJob.downloadUrl,
        thumbnailUrl: thumb ?? dbJob.thumbnailUrl,
        hedraAssetId: s.asset_id ?? dbJob.hedraAssetId,
        errorMessage: s.status === "failed" ? (s.error ?? "Generation failed.") : dbJob.errorMessage,
        completedAt: terminal ? new Date() : dbJob.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(mediaJobs.id, dbJob.id))
      .returning();

    return NextResponse.json({ job: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
