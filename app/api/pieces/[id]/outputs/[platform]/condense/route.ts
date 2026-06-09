import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { db, campaigns, references, pieces } from "@/lib/db";
import type { Piece } from "@/lib/db";
import { getLocalPiece, getLocalReferences, updateLocalPiece } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { condensePost } from "@/lib/ai/condense";
import { getAIForTask } from "@/lib/llm";
import { toErrorResponse } from "@/lib/errors";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

const bodySchema = z.object({ ratio: z.number().min(0.1).max(0.9).optional() });

// Mirrors app/api/pieces/[id]/outputs/route.ts#resolvePiece: owner + workspace.
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

type OutputObject = { draftPost?: string } & Record<string, unknown>;

/**
 * POST /api/pieces/[id]/outputs/[platform]/condense
 * Body: { ratio?: number } (default 0.4). Rewrites ONLY this output's draftPost
 * to ~(1-ratio) of its length, persists it, and returns { platform, draftPost }.
 * Hooks/CTAs/metadata are untouched.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; platform: string }> },
) {
  try {
    const user = await requireUser();
    const { id, platform } = await params;

    const piece = await resolvePiece(id, user);
    if (!piece) return notFound();

    const outputs = (piece.outputs as Record<string, OutputObject> | null) ?? {};
    const target = outputs[platform];
    if (!target || typeof target.draftPost !== "string") return notFound();

    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const ratio = body.ratio ?? 0.4;

    const ref = isLocalFirstMode()
      ? getLocalReferences(piece.campaignId, user.workspaceId)
      : await db.query.references.findFirst({
          where: eq(references.campaignId, piece.campaignId),
        });
    const refCtx = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);

    const draftPost = await condensePost(target.draftPost, refCtx, ratio, getAIForTask("outputs"));

    const nextOutputs = { ...outputs, [platform]: { ...target, draftPost } };
    if (isLocalFirstMode()) {
      updateLocalPiece(piece.id, user.id, { outputs: nextOutputs }, user.workspaceId);
      return NextResponse.json({ platform, draftPost });
    }
    await db
      .update(pieces)
      .set({ outputs: nextOutputs, updatedAt: new Date() })
      .where(and(eq(pieces.id, piece.id), eq(pieces.userId, user.id)));

    return NextResponse.json({ platform, draftPost });
  } catch (err) {
    return toErrorResponse(err);
  }
}
