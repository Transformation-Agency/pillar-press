import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getOrCreateWorkspace, requireUser } from "@/lib/auth";
import { db, campaigns, pieces } from "@/lib/db";
import { bookMarkdown, sortChaptersForBook, type BookChapter } from "@/lib/exporters";
import { toErrorResponse } from "@/lib/errors";
import { getLocalCampaign, listLocalPieces } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { requireExportEnabled } from "@/lib/billing/entitlements";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

/**
 * Resolve a campaign in the caller's workspace, or null. A campaign in another
 * workspace is treated as nonexistent (404, not 403). Mirrors
 * app/api/campaigns/[id]/pieces/route.ts#resolveCampaign.
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

/**
 * GET /api/campaigns/[id]/book/export
 *
 * Assemble the campaign's pieces (chapters) into a single Markdown manuscript.
 * This route runs NO AI — it only reads already-saved chapter text and orders
 * it. campaign = book, piece = chapter.
 *
 * Returns: { campaignId, title, markdown }
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    let userWithWorkspace = user;
    if (!isLocalFirstMode()) {
      const workspaceId = user.workspaceId ?? (await getOrCreateWorkspace(user.id));
      const hostedUser = { ...user, workspaceId };
      await requireExportEnabled(hostedUser);
      userWithWorkspace = hostedUser;
    }

    const campaign = await resolveCampaign(id, userWithWorkspace.workspaceId);
    if (!campaign) return notFound();

    const rows = isLocalFirstMode()
      ? listLocalPieces(campaign.id, user.workspaceId) ?? []
      : await db
          .select()
          .from(pieces)
          .where(eq(pieces.campaignId, campaign.id))
          .orderBy(asc(pieces.createdAt));

    const chapters = sortChaptersForBook(
      rows.map(
        (p): BookChapter => ({
          title: p.title,
          original: p.original,
          revision: (p.revision as { text?: string | null } | null) ?? null,
          createdAt: p.createdAt,
        }),
      ),
    );

    const markdown = bookMarkdown({ title: campaign.name, chapters });

    return NextResponse.json({ campaignId: campaign.id, title: campaign.name, markdown });
  } catch (err) {
    return toErrorResponse(err);
  }
}
