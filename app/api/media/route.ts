import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, mediaJobs } from "@/lib/db";
import { deleteLocalMediaJob, listLocalMediaJobs } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { toErrorResponse } from "@/lib/errors";

// GET /api/media?pieceId=...   -> the current user's saved media jobs
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const pieceId = new URL(req.url).searchParams.get("pieceId");
    if (isLocalFirstMode()) {
      return NextResponse.json({ items: listLocalMediaJobs(user.id, pieceId) });
    }
    const where = pieceId
      ? and(eq(mediaJobs.userId, user.id), eq(mediaJobs.sourceContentId, pieceId))
      : eq(mediaJobs.userId, user.id);
    const items = await db.select().from(mediaJobs).where(where).orderBy(desc(mediaJobs.createdAt)).limit(200);
    return NextResponse.json({ items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/media?id=...     -> remove from the local library (user-scoped)
export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id.", code: "bad_request" }, { status: 400 });
    if (isLocalFirstMode()) {
      deleteLocalMediaJob(id, user.id);
      return NextResponse.json({ ok: true });
    }
    await db.delete(mediaJobs).where(and(eq(mediaJobs.id, id), eq(mediaJobs.userId, user.id)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
