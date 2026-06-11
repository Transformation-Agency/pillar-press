import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db, references, pieces } from "@/lib/db";
import { styleProfiles } from "@/db/style-schema";
import { getLocalPiece, getLocalReferences, getLocalStyleProfile } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { craftImagePrompt } from "@/lib/ai/imagePrompt";
import { getAIForTaskForUser } from "@/lib/llm";
import { sanitizeText } from "@/lib/validation";
import { toErrorResponse } from "@/lib/errors";
import { campaignInWorkspace, tenantNotFound } from "@/lib/tenant";
import { completeUsageReservation, failUsageReservation, reserveUsage, type UsageReservation } from "@/lib/billing/usage";

const bodySchema = z.object({
  prompt: z.string().max(2000).optional(),
  campaignId: z.string().optional(),
  pieceId: z.string().uuid().optional(),
});

function pieceExcerpt(p: { original?: string | null; revision?: unknown } | undefined): string {
  if (!p) return "";
  const rev = p.revision as { text?: string } | null | undefined;
  return (rev?.text || p.original || "").replace(/\s+/g, " ").trim().slice(0, 700);
}

// POST /api/hedra/prompt — preview/regenerate the art-directed image prompt
// WITHOUT generating an image (no Hedra credits). Same inputs the generator
// uses: seed + campaign brand/style + the linked article. Returns { prompt }.
export async function POST(req: Request) {
  let reservation: UsageReservation = null;
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await req.json());

    let refCtx = "";
    let directive = "";
    if (body.campaignId) {
      if (!(await campaignInWorkspace(body.campaignId, user.workspaceId))) return tenantNotFound();
      const ref = isLocalFirstMode()
        ? getLocalReferences(body.campaignId, user.workspaceId)
        : await db.query.references.findFirst({ where: eq(references.campaignId, body.campaignId) });
      refCtx = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);
      const prof = isLocalFirstMode()
        ? getLocalStyleProfile(body.campaignId, user.workspaceId)
        : await db.query.styleProfiles.findFirst({ where: eq(styleProfiles.campaignId, body.campaignId) });
      directive = prof?.directive || "";
    }

    let article: { title?: string; excerpt?: string } | undefined;
    if (body.pieceId) {
      const pc = isLocalFirstMode()
        ? getLocalPiece(body.pieceId, user.id, user.workspaceId)
        : await db.query.pieces.findFirst({
            where: and(eq(pieces.id, body.pieceId), eq(pieces.userId, user.id)),
          });
      if (!pc || !(await campaignInWorkspace(pc.campaignId, user.workspaceId))) return tenantNotFound();
      if (pc) article = { title: pc.title, excerpt: pieceExcerpt(pc) };
    }

    const taskAI = await getAIForTaskForUser("mediaPrompt", user);
    reservation = await reserveUsage({
      user,
      task: "utility",
      feature: "hedra.prompt",
      campaignId: body.campaignId,
      pieceId: body.pieceId,
      providerSource: taskAI.providerSource,
      provider: taskAI.provider,
      model: taskAI.model,
      metadata: taskAI.profileId ? { profileId: taskAI.profileId } : {},
      estimatedCredits: 1,
    });
    const prompt = await craftImagePrompt({
      seed: sanitizeText(body.prompt, 2000),
      styleDirective: directive,
      refContext: refCtx,
      article,
    }, taskAI.ai);
    await completeUsageReservation(reservation);
    return NextResponse.json({ prompt });
  } catch (err) {
    await failUsageReservation(reservation, err);
    return toErrorResponse(err);
  }
}
