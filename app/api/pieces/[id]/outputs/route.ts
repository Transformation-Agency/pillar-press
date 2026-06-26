import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { db, campaigns, references, pieces } from "@/lib/db";
import type { Piece } from "@/lib/db";
import { getLocalPiece, getLocalReferences, updateLocalPiece } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { getAIForTaskForUser } from "@/lib/llm";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { generateOutputs, type GeneratorPiece } from "@/lib/generators";
import { outputsBodySchema } from "@/lib/schemas-generators";
import { toErrorResponse } from "@/lib/errors";
import { completeUsageReservation, failUsageReservation, reserveUsage, type UsageReservation } from "@/lib/billing/usage";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

export const maxDuration = 900;

/**
 * Load a piece the caller may touch, or null. The piece must be owned by the
 * caller AND live in a campaign within the caller's workspace. Anything else
 * (other user, other workspace, nonexistent) → null → 404, so we never reveal
 * that the row exists. Mirrors app/api/pieces/[id]/route.ts#resolvePiece.
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
 * POST /api/pieces/[id]/outputs
 *
 * Body: { active: string[], audiences: { [platform]: audienceId } }.
 *
 * Generates platform-native posts in the fixed PLATFORMS order (threading prior
 * outputs), reading the piece's campaign references for prompt context, then
 * persists `outputs` (keyed by platform id) + `output_order`. Logic lives in
 * lib/generators.ts#generateOutputs; this handler only does auth + db + persist.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let reservation: UsageReservation = null;
  try {
    const user = await requireUser();
    const { id } = await params;

    const piece = await resolvePiece(id, user);
    if (!piece) return notFound();

    const body = outputsBodySchema.parse(await req.json());

    // Read the campaign's CURRENT references doc for prompt context (the gates
    // and generators must always read the live version).
    const ref = isLocalFirstMode()
      ? getLocalReferences(piece.campaignId, user.workspaceId)
      : await db.query.references.findFirst({
          where: eq(references.campaignId, piece.campaignId),
        });
    const refCtx = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);

    const generatorPiece: GeneratorPiece = {
      original: piece.original,
      revision: (piece.revision as GeneratorPiece["revision"]) ?? null,
    };

    const taskAI = await getAIForTaskForUser("outputs", user);
    reservation = await reserveUsage({
      user,
      task: "outputs",
      feature: "pieces.outputs",
      campaignId: piece.campaignId,
      pieceId: piece.id,
      providerSource: taskAI.providerSource,
      provider: taskAI.provider,
      model: taskAI.model,
      metadata: taskAI.profileId ? { profileId: taskAI.profileId } : {},
      estimatedCredits: Math.max(1, body.active.length * 2),
    });
    const { outputs, order } = await generateOutputs(
      generatorPiece,
      body.active,
      body.audiences,
      refCtx,
      taskAI.ai,
    );

    if (isLocalFirstMode()) {
      const updated = updateLocalPiece(piece.id, user.id, { outputs, outputOrder: order }, user.workspaceId);
      if (!updated) return notFound();
      await completeUsageReservation(reservation, { actualCredits: Math.max(1, order.length * 2) });
      return NextResponse.json({ piece: updated, outputs, outputOrder: order });
    }

    const [updated] = await db
      .update(pieces)
      .set({ outputs, outputOrder: order, updatedAt: new Date() })
      .where(and(eq(pieces.id, piece.id), eq(pieces.userId, user.id)))
      .returning();

    await completeUsageReservation(reservation, { actualCredits: Math.max(1, order.length * 2) });
    return NextResponse.json({ piece: updated, outputs, outputOrder: order });
  } catch (err) {
    await failUsageReservation(reservation, err);
    return toErrorResponse(err);
  }
}
