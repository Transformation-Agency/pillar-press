import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, campaigns } from "@/lib/db";
import { styleProfiles, DEFAULT_KNOBS } from "@/db/style-schema";
import { toErrorResponse } from "@/lib/errors";
import { getLocalCampaign, getLocalStyleProfile } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";

async function campaignInScope(id: string, workspaceId?: string): Promise<boolean> {
  if (!workspaceId) return false;
  if (isLocalFirstMode()) return !!getLocalCampaign(id, workspaceId);
  const c = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspaceId)),
  });
  return !!c;
}

// GET /api/campaigns/[id]/style → the campaign's { knobs, directive, rounds }
// (defaults if no profile exists yet).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!(await campaignInScope(id, user.workspaceId)))
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

    const p = isLocalFirstMode()
      ? getLocalStyleProfile(id, user.workspaceId)
      : await db.query.styleProfiles.findFirst({ where: eq(styleProfiles.campaignId, id) });
    return NextResponse.json({
      knobs: p?.knobs ?? DEFAULT_KNOBS,
      directive: p?.directive ?? "",
      rounds: p?.rounds ?? 0,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
