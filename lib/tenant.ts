import { and, eq } from "drizzle-orm";
import { db, campaigns } from "@/lib/db";
import { getLocalCampaign } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";

export function tenantNotFound() {
  return Response.json({ error: "Not found.", code: "not_found" }, { status: 404 });
}

export async function campaignInWorkspace(
  campaignId: string | null | undefined,
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (!campaignId || !workspaceId) return false;
  if (isLocalFirstMode()) return Boolean(getLocalCampaign(campaignId, workspaceId));
  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
  });
  return Boolean(campaign);
}
