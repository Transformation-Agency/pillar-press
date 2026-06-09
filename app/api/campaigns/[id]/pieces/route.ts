import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, campaigns, pieces } from "@/lib/db";
import { createLocalPiece, getLocalCampaign, listLocalPieces } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { createPieceSchema } from "@/lib/schemas-pieces";
import { toErrorResponse } from "@/lib/errors";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

/**
 * Resolve a campaign that belongs to the caller's workspace, or null.
 * A campaign in another workspace is treated as nonexistent (404, not 403) so
 * we never reveal that it exists.
 */
async function resolveCampaign(cid: string, workspaceId: string | undefined) {
  if (!workspaceId) return null;
  if (isLocalFirstMode()) return getLocalCampaign(cid, workspaceId);
  return (
    (await db.query.campaigns.findFirst({
      where: and(eq(campaigns.id, cid), eq(campaigns.workspaceId, workspaceId)),
    })) ?? null
  );
}

// GET /api/campaigns/[cid]/pieces
// Library list: every piece in the campaign, newest first. Scoped to the
// caller's workspace; an unknown/other-workspace campaign → 404.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const campaign = await resolveCampaign(id, user.workspaceId);
    if (!campaign) return notFound();

    if (isLocalFirstMode()) {
      const list = listLocalPieces(campaign.id, user.workspaceId);
      if (!list) return notFound();
      return NextResponse.json({ pieces: list });
    }

    const list = await db
      .select()
      .from(pieces)
      .where(eq(pieces.campaignId, campaign.id))
      .orderBy(desc(pieces.createdAt));

    return NextResponse.json({ pieces: list });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/campaigns/[cid]/pieces
// Create a piece in the campaign (status Draft). Body: { title, original? }.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const campaign = await resolveCampaign(id, user.workspaceId);
    if (!campaign) return notFound();

    const body = createPieceSchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const piece = createLocalPiece(
        {
          id: body.id,
          campaignId: campaign.id,
          userId: user.id,
          title: body.title,
          original: body.original ?? "",
        },
        user.workspaceId,
      );
      if (!piece) return notFound();
      return NextResponse.json({ piece }, { status: 201 });
    }

    const [piece] = await db
      .insert(pieces)
      .values({
        ...(body.id ? { id: body.id } : {}),
        campaignId: campaign.id,
        userId: user.id,
        title: body.title,
        status: "Draft",
        original: body.original ?? "",
      })
      .returning();

    return NextResponse.json({ piece }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
