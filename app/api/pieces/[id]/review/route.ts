import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { db, campaigns, pieces, references } from "@/lib/db";
import type { Piece } from "@/lib/db";
import { getLocalPiece, getLocalReferences, updateLocalPiece } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { getAIForTask } from "@/lib/llm";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { GATES, runGate, type GateResult } from "@/lib/gates";
import { toErrorResponse } from "@/lib/errors";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

/**
 * Load a piece the caller is allowed to touch, or null. The piece must be owned
 * by the caller AND live in a campaign within the caller's workspace. Anything
 * else (other user, other workspace, nonexistent) → null, surfaced as 404 so we
 * never reveal that the row exists. (Mirrors resolvePiece in
 * app/api/pieces/[id]/route.ts.)
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

// POST /api/pieces/[id]/review
// Runs the 7 gates IN ORDER against the piece's draft, persisting
// piece.packet[gateId] incrementally after each gate, then sets status
// Draft→Reviewed and returns the full packet.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const piece = await resolvePiece(id, user);
    if (!piece) return notFound();

    // Build the author reference context for this piece's campaign.
    const ref = isLocalFirstMode()
      ? getLocalReferences(piece.campaignId, user.workspaceId)
      : await db.query.references.findFirst({
          where: eq(references.campaignId, piece.campaignId),
        });
    const refCtx = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);

    // The draft under review is the piece's original text (prototype: task(draft)).
    const draft = piece.original ?? "";

    // Accumulate into a fresh packet keyed by gate id. Start from any existing
    // packet so a re-review overwrites gate-by-gate rather than wiping it first.
    const packet: Record<string, GateResult> = {
      ...((piece.packet as Record<string, GateResult> | null) ?? {}),
    };

    // Run gates IN ORDER, persisting incrementally after each one.
    const reviewAI = getAIForTask("review");
    for (const gate of GATES) {
      const result = await runGate(gate, draft, refCtx, reviewAI);
      packet[gate.id] = result;
      if (isLocalFirstMode()) {
        updateLocalPiece(piece.id, user.id, { packet }, user.workspaceId);
        continue;
      }
      await db
        .update(pieces)
        .set({ packet, updatedAt: new Date() })
        .where(and(eq(pieces.id, piece.id), eq(pieces.userId, user.id)));
    }

    // Draft → Reviewed (idempotent; only advance from Draft).
    const nextStatus = piece.status === "Draft" ? "Reviewed" : piece.status;
    if (isLocalFirstMode()) {
      updateLocalPiece(piece.id, user.id, { status: nextStatus }, user.workspaceId);
      return NextResponse.json({ packet, status: nextStatus });
    }
    await db
      .update(pieces)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(and(eq(pieces.id, piece.id), eq(pieces.userId, user.id)));

    return NextResponse.json({ packet, status: nextStatus });
  } catch (err) {
    return toErrorResponse(err);
  }
}
