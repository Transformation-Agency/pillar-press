import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, mediaJobs } from "@/lib/db";
import { getGenerationStatus } from "@/lib/hedra";
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
    const [updated] = await db
      .update(mediaJobs)
      .set({
        status: (s.status as any) ?? job.status,
        progress: s.progress ?? job.progress,
        outputUrl: s.url ?? job.outputUrl,
        downloadUrl: s.download_url ?? job.downloadUrl,
        thumbnailUrl: s.thumbnail_url ?? job.thumbnailUrl,
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
