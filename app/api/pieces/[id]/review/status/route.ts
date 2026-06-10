import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { db, campaigns, pieces } from "@/lib/db";
import type { Piece } from "@/lib/db";
import { getLocalPiece } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { GATES, type GateResult } from "@/lib/gates";
import { toErrorResponse } from "@/lib/errors";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

// Scoped piece load (see app/api/pieces/[id]/review/route.ts).
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

// GET /api/pieces/[id]/review/status
// Poll the incremental review: returns the current packet, the piece status, and
// which gate ids have completed (in order) so the client can fill the rail
// gate-by-gate while POST /review is still running.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const piece = await resolvePiece(id, user);
    if (!piece) return notFound();

    const packet = (piece.packet as Record<string, GateResult> | null) ?? {};
    const completed = GATES.filter((g) => packet[g.id]).map((g) => g.id);

    return NextResponse.json({
      status: piece.status,
      packet,
      completed,
      total: GATES.length,
      done: completed.length >= GATES.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
