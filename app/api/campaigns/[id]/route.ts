import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, campaigns } from "@/lib/db";
import { renameLocalCampaign } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { renameCampaignSchema } from "@/lib/schemas-campaigns";
import { toErrorResponse } from "@/lib/errors";

// PATCH /api/campaigns/:id  { name }
// Rename a campaign. Scoped to the caller's workspace — a campaign in another
// workspace responds 404 (don't reveal existence).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!user.workspaceId) {
      return NextResponse.json(
        { error: "Not found.", code: "not_found" },
        { status: 404 },
      );
    }

    const { name } = renameCampaignSchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const campaign = renameLocalCampaign(id, name, user.workspaceId);
      if (!campaign) {
        return NextResponse.json(
          { error: "Not found.", code: "not_found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ campaign });
    }

    const [updated] = await db
      .update(campaigns)
      .set({ name, updatedAt: new Date() })
      .where(
        and(
          eq(campaigns.id, id),
          eq(campaigns.workspaceId, user.workspaceId),
        ),
      )
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Not found.", code: "not_found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ campaign: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
