import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, campaigns, pieces, references } from "@/lib/db";
import { getLocalPiece, getLocalReferences, updateLocalPiece } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { getAIForTask } from "@/lib/llm";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { generateRevision, type RevisionPacket, type RevisionPieceInput } from "@/lib/revision";
import { failRevisionProgress, finishRevisionProgress, startRevisionProgress, updateRevisionProgress } from "@/lib/revisionStatus";
import { toErrorResponse } from "@/lib/errors";
import type { SessionUser } from "@/lib/auth";
import type { Piece } from "@/lib/db";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

/**
 * Load a piece the caller is allowed to touch, or null. The piece must be owned
 * by the caller AND live in a campaign within the caller's workspace. Anything
 * else (other user, other workspace, nonexistent) → null, surfaced as 404 so we
 * never reveal that the row exists.
 */
async function resolvePiece(id: string, user: SessionUser): Promise<Piece | null> {
  if (isLocalFirstMode()) return getLocalPiece(id, user.id, user.workspaceId) as Piece | null;
  const piece = await db.query.pieces.findFirst({
    where: and(eq(pieces.id, id), eq(pieces.userId, user.id)),
  });
  if (!piece) return null;
  if (!user.workspaceId) return null;

  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, piece.campaignId), eq(campaigns.workspaceId, user.workspaceId)),
  });
  if (!campaign) return null;

  return piece;
}

/**
 * POST /api/pieces/[id]/revision
 *
 * Runs the chunked Proposed Revision passes (lib/revision.ts#generateRevision),
 * applying ONLY clarity/tone/inoculation findings from the piece's packet (the
 * firewall — strategy/audience/rigor/identity never inform the revision).
 * Persists revision = { text, changelog: [{ finding, change, note }] } and sets
 * Reviewed → Revised. Logic ported from generators.js#generateRevision.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    // Optional { mode: "light" | "full" }. Default light (the firewall pass).
    // "full" runs a whole-document restructure (strategy/structure/etc.) first.
    let mode: "light" | "full" = "light";
    let runId = "";
    try {
      const body = (await req.json()) as { mode?: unknown; runId?: unknown } | null;
      if (body && body.mode === "full") mode = "full";
      if (body && typeof body.runId === "string") runId = body.runId.slice(0, 120);
    } catch {
      /* empty/no body → light */
    }

    const piece = await resolvePiece(id, user);
    if (!piece) return notFound();

    // Load the campaign's references doc to build the author ref-context. The
    // campaign (and thus this campaignId) was already authorized in resolvePiece.
    const ref = isLocalFirstMode()
      ? getLocalReferences(piece.campaignId, user.workspaceId)
      : await db.query.references.findFirst({
          where: eq(references.campaignId, piece.campaignId),
        });
    const refDoc = (ref?.doc ?? null) as ReferencesDoc | null;
    const refCtx = buildRefContext(refDoc);

    const input: RevisionPieceInput = {
      original: piece.original,
      packet: (piece.packet ?? null) as RevisionPacket | null,
      gateNotes: (piece.gateNotes ?? null) as Record<string, string> | null,
      direction: piece.direction ?? null,
    };

    if (runId) startRevisionProgress(piece.id, runId, mode);

    let result;
    try {
      result = await generateRevision(
        input,
        refCtx,
        getAIForTask("revision"),
        runId ? (done, total) => updateRevisionProgress(piece.id, runId, done, total) : undefined,
        { mode },
      );
    } catch (err) {
      if (runId) failRevisionProgress(piece.id, runId, (err as Error)?.message || "Revision failed.");
      throw err;
    }

    if (isLocalFirstMode()) {
      const updated = updateLocalPiece(
        piece.id,
        user.id,
        {
          revision: result,
          ...(piece.status === "Reviewed" ? { status: "Revised" as const } : {}),
        },
        user.workspaceId,
      );
      if (!updated) return notFound();
      if (runId) finishRevisionProgress(piece.id, runId, result);
      return NextResponse.json({ piece: updated });
    }

    const [updated] = await db
      .update(pieces)
      .set({
        revision: result,
        // Reviewed → Revised. Leave any non-Reviewed status untouched.
        ...(piece.status === "Reviewed" ? { status: "Revised" as const } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(pieces.id, piece.id), eq(pieces.userId, user.id)))
      .returning();

    if (runId) finishRevisionProgress(piece.id, runId, result);
    return NextResponse.json({ piece: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
