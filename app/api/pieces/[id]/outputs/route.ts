import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { db, campaigns, references, pieces } from "@/lib/db";
import type { Piece } from "@/lib/db";
import { getLocalPiece, getLocalReferences, updateLocalPiece } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { getAIForTask } from "@/lib/llm";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { generateOutputs, type GeneratorPiece } from "@/lib/generators";
import { outputsBodySchema } from "@/lib/schemas-generators";
import { toErrorResponse } from "@/lib/errors";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

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

    const { outputs, order } = await generateOutputs(
      generatorPiece,
      body.active,
      body.audiences,
      refCtx,
      getAIForTask("outputs"),
    );

    if (isLocalFirstMode()) {
      const updated = updateLocalPiece(piece.id, user.id, { outputs, outputOrder: order }, user.workspaceId);
      if (!updated) return notFound();
      return NextResponse.json({ piece: updated, outputs, outputOrder: order });
    }

    const [updated] = await db
      .update(pieces)
      .set({ outputs, outputOrder: order, updatedAt: new Date() })
      .where(and(eq(pieces.id, piece.id), eq(pieces.userId, user.id)))
      .returning();

    return NextResponse.json({ piece: updated, outputs, outputOrder: order });
  } catch (err) {
    return toErrorResponse(err);
  }
}
