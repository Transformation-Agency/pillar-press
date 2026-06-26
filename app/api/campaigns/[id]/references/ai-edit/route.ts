import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assertAuthor } from "@/lib/auth";
import { db, campaigns, references } from "@/lib/db";
import { craftReferencesEdit } from "@/lib/ai/refsEdit";
import { type ReferencesDoc } from "@/lib/refContext";
import { getAIForTaskForUser } from "@/lib/llm";
import { toErrorResponse } from "@/lib/errors";
import { getLocalCampaign, getLocalReferences } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { completeUsageReservation, failUsageReservation, reserveUsage, type UsageReservation } from "@/lib/billing/usage";

const bodySchema = z.object({ instruction: z.string().trim().min(3).max(2000) });

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

/**
 * POST /api/campaigns/:id/references/ai-edit  { instruction }
 *
 * Apply a natural-language instruction to the campaign's references document via
 * AI and return the proposed { doc, summary } — does NOT persist; the client
 * reviews and applies it through the existing references PUT. AUTHOR ONLY
 * (assistants may not edit references), mirroring the PUT route's guard.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let reservation: UsageReservation = null;
  try {
    const user = await assertAuthor();
    const { id } = await params;

    if (!user.workspaceId) return notFound();
    const campaign = isLocalFirstMode()
      ? getLocalCampaign(id, user.workspaceId)
      : await db.query.campaigns.findFirst({
          where: and(eq(campaigns.id, id), eq(campaigns.workspaceId, user.workspaceId)),
        });
    if (!campaign) return notFound();

    const body = bodySchema.parse(await req.json());

    const ref = isLocalFirstMode()
      ? getLocalReferences(campaign.id, user.workspaceId)
      : await db.query.references.findFirst({ where: eq(references.campaignId, campaign.id) });
    if (!ref) return notFound();

    const taskAI = await getAIForTaskForUser("utility", user);
    reservation = await reserveUsage({
      user,
      task: "utility",
      feature: "references.ai_edit",
      campaignId: campaign.id,
      providerSource: taskAI.providerSource,
      provider: taskAI.provider,
      model: taskAI.model,
      metadata: taskAI.profileId ? { profileId: taskAI.profileId } : {},
      estimatedCredits: Math.max(1, Math.ceil(JSON.stringify(ref.doc ?? {}).length / 12000)),
    });
    const result = await craftReferencesEdit({
      doc: (ref.doc as ReferencesDoc) ?? {},
      instruction: body.instruction,
    }, taskAI.ai);

    if (!result.ok) {
      await failUsageReservation(reservation, new Error("References AI edit returned invalid output."));
      return NextResponse.json(
        { error: "The AI couldn't produce a valid edit. Try rephrasing your instruction.", code: "ai_parse" },
        { status: 422 },
      );
    }

    await completeUsageReservation(reservation);
    return NextResponse.json({ doc: result.doc, summary: result.summary });
  } catch (err) {
    await failUsageReservation(reservation, err);
    return toErrorResponse(err);
  }
}
