import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runSchema } from "@/lib/gather-validation";
import { runGatherForCampaign } from "@/lib/gather/runCampaign";
import { toErrorResponse } from "@/lib/errors";
import { campaignInWorkspace, tenantNotFound } from "@/lib/tenant";
import { completeUsageReservation, failUsageReservation, reserveUsage, type UsageReservation } from "@/lib/billing/usage";
import { getAIForTaskForUser } from "@/lib/llm";

// Per-source LLM summaries can take a few seconds each (run concurrently).
export const maxDuration = 60;

// POST /api/gather/run  { campaignId }
// Runs the campaign's enabled sources through the real connectors, persists the
// items (de-duped by url), then runs ONE independent LLM call per source to
// synthesize that source's fetched results into a research brief. Returns the
// saved items, per-source counts, and the per-source summaries.
export async function POST(req: Request) {
  let reservation: UsageReservation = null;
  try {
    const user = await requireUser();
    const { campaignId } = runSchema.parse(await req.json());

    if (!(await campaignInWorkspace(campaignId, user.workspaceId))) return tenantNotFound();
    const taskAI = await getAIForTaskForUser("gather", user);
    reservation = await reserveUsage({
      user,
      task: "gather",
      feature: "gather.run",
      campaignId,
      providerSource: taskAI.providerSource,
      provider: taskAI.provider,
      model: taskAI.model,
      metadata: taskAI.profileId ? { profileId: taskAI.profileId } : {},
    });
    const result = await runGatherForCampaign(campaignId, user, taskAI.ai);
    if (!result) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    await completeUsageReservation(reservation, {
      actualCredits: 1,
      metadata: { found: result.found, saved: result.saved },
    });
    return NextResponse.json(result);
  } catch (err) {
    await failUsageReservation(reservation, err);
    return toErrorResponse(err);
  }
}
