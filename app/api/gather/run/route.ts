import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runSchema } from "@/lib/gather-validation";
import { runGatherForCampaign } from "@/lib/gather/runCampaign";
import { toErrorResponse } from "@/lib/errors";

// Per-source LLM summaries can take a few seconds each (run concurrently).
export const maxDuration = 60;

// POST /api/gather/run  { campaignId }
// Runs the campaign's enabled sources through the real connectors, persists the
// items (de-duped by url), then runs ONE independent LLM call per source to
// synthesize that source's fetched results into a research brief. Returns the
// saved items, per-source counts, and the per-source summaries.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { campaignId } = runSchema.parse(await req.json());

    const result = await runGatherForCampaign(campaignId, user);
    if (!result) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
