import { and, eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth";
import { campaigns, db, letterWorkflows } from "@/lib/db";
import { getLocalLetterWorkflowForPiece } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";

export async function getLetterContextForPiece(pieceId: string, user: SessionUser) {
  if (!user.workspaceId) return null;
  if (isLocalFirstMode()) {
    return getLocalLetterWorkflowForPiece(pieceId, user.id, user.workspaceId);
  }

  const workflow = await db.query.letterWorkflows.findFirst({
    where: and(eq(letterWorkflows.pieceId, pieceId), eq(letterWorkflows.userId, user.id), eq(letterWorkflows.workspaceId, user.workspaceId)),
  });
  if (!workflow) return null;

  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, workflow.campaignId), eq(campaigns.workspaceId, user.workspaceId)),
  });
  return campaign ? workflow : null;
}
