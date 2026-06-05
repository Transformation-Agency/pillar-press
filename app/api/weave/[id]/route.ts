import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getJobForUser } from "@/lib/weaveJobs";
import { toErrorResponse } from "@/lib/errors";

// GET /api/weave/[id]
// Poll a background weave job (started via POST /api/weave?async=1). Scoped to
// the caller: a job that isn't theirs (or has expired) → 404, never revealing it
// exists. On completion the body carries the same { extracts, brief, mapping,
// draft } result the synchronous POST returns.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const job = getJobForUser(id, user.id);
    if (!job) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      result: job.result,
      error: job.error,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
