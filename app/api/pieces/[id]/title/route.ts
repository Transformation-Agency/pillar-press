import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser, type SessionUser } from "@/lib/auth";
import { db, campaigns, pieces, references, type Piece } from "@/lib/db";
import { getLocalPiece, getLocalReferences } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { craftTitle } from "@/lib/ai/titlePiece";
import { getAIForTask } from "@/lib/llm";
import { toErrorResponse } from "@/lib/errors";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

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
 * POST /api/pieces/[id]/title — generate a title from the piece's text (the
 * revised draft if present, else the original). Returns { title }; the client
 * applies it. AI-only, no persistence here.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const piece = await resolvePiece(id, user);
    if (!piece) return notFound();

    const rev = piece.revision as { text?: string } | null;
    const text = (rev?.text || piece.original || "").trim();
    if (!text) return NextResponse.json({ error: "This piece has no text to title yet.", code: "validation" }, { status: 422 });

    const ref = isLocalFirstMode()
      ? getLocalReferences(piece.campaignId, user.workspaceId)
      : await db.query.references.findFirst({ where: eq(references.campaignId, piece.campaignId) });
    const refCtx = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);

    const title = await craftTitle({ text, refContext: refCtx }, getAIForTask("draft"));
    if (!title) return NextResponse.json({ error: "Couldn't generate a title.", code: "ai" }, { status: 502 });

    return NextResponse.json({ title });
  } catch (err) {
    return toErrorResponse(err);
  }
}
