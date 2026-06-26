import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { backgroundJobs, db } from "@/lib/db";
import { isLocalFirstMode } from "@/lib/local/mode";
import { toErrorResponse } from "@/lib/errors";

function publicJob(job: typeof backgroundJobs.$inferSelect) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    campaignId: job.campaignId,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: job.runAfter,
    result: job.result ?? {},
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await requireUser();
    if (isLocalFirstMode() || !user.workspaceId) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }
    const { jobId } = await params;
    const job = await db.query.backgroundJobs.findFirst({
      where: and(
        eq(backgroundJobs.id, jobId),
        eq(backgroundJobs.workspaceId, user.workspaceId),
        eq(backgroundJobs.userId, user.id),
        eq(backgroundJobs.kind, "gather_run"),
      ),
    });
    if (!job) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    return NextResponse.json({ job: publicJob(job) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
