import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gatherSources } from "@/db/gather-schema";
import { updateSourceSchema } from "@/lib/gather-validation";
import { toErrorResponse } from "@/lib/errors";

// PATCH /api/gather/sources/[id] — update config / label / enabled (user-scoped).
// Without this, typed queries and the on/off toggle never reach the server, so a
// run reads blank-config sources and returns nothing.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const patch = updateSourceSchema.parse(await req.json());
    // The client also PATCHes run stats (lastRun/lastCount) which the schema
    // strips; the run route already persists those, so an empty patch is a no-op.
    if (Object.keys(patch).length === 0) {
      const [row] = await db
        .select()
        .from(gatherSources)
        .where(and(eq(gatherSources.id, id), eq(gatherSources.userId, user.id)))
        .limit(1);
      return NextResponse.json({ source: row ?? null });
    }
    // Clearing the brief (summary: null) also clears its timestamp/count.
    const set =
      "summary" in patch && patch.summary === null
        ? { ...patch, summaryAt: null, summaryItemCount: null }
        : patch;
    const [row] = await db
      .update(gatherSources)
      .set(set)
      .where(and(eq(gatherSources.id, id), eq(gatherSources.userId, user.id)))
      .returning();
    if (!row) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    return NextResponse.json({ source: row });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/gather/sources/[id] — remove a source (user-scoped).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await db.delete(gatherSources).where(and(eq(gatherSources.id, id), eq(gatherSources.userId, user.id)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
