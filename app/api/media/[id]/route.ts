import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db, mediaJobs, pieces } from "@/lib/db";
import { getLocalMediaJob, getLocalPiece, updateLocalMediaJob } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { toErrorResponse } from "@/lib/errors";

// Attach (string pieceId) or detach (null) a media job to/from a piece.
// `pieceId` is the piece's id, persisted on the job as `source_content_id`.
const patchBodySchema = z.object({
  pieceId: z.string().uuid().nullable(),
});

// PATCH /api/media/[id]
// Attach/detach a media job to a piece by setting/clearing source_content_id.
// Strictly user-scoped: a job that isn't the caller's → 404 (don't reveal it).
// When attaching, the target piece must also belong to the caller → 404 otherwise.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { pieceId } = patchBodySchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const job = getLocalMediaJob(id, user.id);
      if (!job) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
      if (pieceId && !getLocalPiece(pieceId, user.id, user.workspaceId)) {
        return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
      }
      const updated = updateLocalMediaJob(id, user.id, { pieceId });
      return NextResponse.json({ job: updated });
    }

    // 1) authorize the job to the current user (no cross-user writes)
    const job = await db.query.mediaJobs.findFirst({
      where: and(eq(mediaJobs.id, id), eq(mediaJobs.userId, user.id)),
    });
    if (!job) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

    // 2) when attaching, the target piece must be the caller's too (404 otherwise)
    if (pieceId) {
      const piece = await db.query.pieces.findFirst({
        where: and(eq(pieces.id, pieceId), eq(pieces.userId, user.id)),
      });
      if (!piece) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }

    // 3) set (attach) or clear (detach) the link, re-scoped by user.id on write
    const [updated] = await db
      .update(mediaJobs)
      .set({ sourceContentId: pieceId, updatedAt: new Date() })
      .where(and(eq(mediaJobs.id, job.id), eq(mediaJobs.userId, user.id)))
      .returning();

    return NextResponse.json({ job: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
