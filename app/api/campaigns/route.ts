import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, campaigns, references } from "@/lib/db";
import { createLocalCampaign, listLocalCampaigns } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { EMPTY_REFERENCES, slug, type SeedReferences } from "@/lib/seed";
import { createCampaignSchema } from "@/lib/schemas-campaigns";
import { toErrorResponse } from "@/lib/errors";

// GET /api/campaigns
// List the campaigns in the caller's workspace. Scoped by workspace; campaigns
// from other workspaces are never returned.
export async function GET() {
  try {
    const user = await requireUser();
    if (!user.workspaceId) return NextResponse.json({ campaigns: [] });

    if (isLocalFirstMode()) {
      return NextResponse.json({ campaigns: listLocalCampaigns(user.workspaceId) });
    }

    const rows = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.workspaceId, user.workspaceId))
      .orderBy(asc(campaigns.createdAt));

    return NextResponse.json({ campaigns: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/campaigns  { name }
// Create a campaign in the caller's workspace and create a blank references row.
// The slug is
// derived from the name and de-duplicated within the workspace, mirroring the
// prototype's addCampaign().
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.workspaceId) {
      return NextResponse.json(
        { error: "No workspace.", code: "bad_request" },
        { status: 400 },
      );
    }

    const { id: providedId, name } = createCampaignSchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const campaign = createLocalCampaign({ id: providedId, name, workspaceId: user.workspaceId });
      return NextResponse.json({ campaign }, { status: 201 });
    }

    // Unique slug within the workspace (base, base-2, base-3, ...).
    const base = slug(name) || "campaign";
    let candidate = base;
    let i = 2;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const existing = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.workspaceId, user.workspaceId),
            eq(campaigns.slug, candidate),
          ),
        )
        .limit(1);
      if (existing.length === 0) break;
      candidate = `${base}-${i++}`;
    }

    const [campaign] = await db
      .insert(campaigns)
      .values({
        ...(providedId ? { id: providedId } : {}),
        workspaceId: user.workspaceId,
        slug: candidate,
        name,
      })
      .returning();

    await db.insert(references).values({
      campaignId: campaign.id,
      doc: JSON.parse(JSON.stringify(EMPTY_REFERENCES)) as SeedReferences,
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
