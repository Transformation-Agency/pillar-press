import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, campaigns, references } from "@/lib/db";
import { getAIForTask } from "@/lib/llm";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { runWeave } from "@/lib/weave";
import { weaveBodySchema } from "@/lib/schemas-weave";
import { createJob, setProgress, completeJob, failJob } from "@/lib/weaveJobs";
import { toErrorResponse } from "@/lib/errors";
import { getLocalCampaign, getLocalReferences } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";

// Long runs: explicitly opt in to the job path with ?async=1. Default is the
// synchronous result, which the brief allows.
function wantsAsync(req: Request): boolean {
  const v = new URL(req.url).searchParams.get("async");
  return v === "1" || v === "true";
}

/**
 * Build the author's reference context for the weave.
 *
 * If a campaignId is supplied it MUST belong to the caller's workspace; an
 * unknown / cross-workspace campaign is treated as nonexistent (404, not 403,
 * so we never reveal it). With no campaignId the weave runs with an empty
 * reference context (the prototype guards every reference block, so "" is valid).
 *
 * Returns the context string, or null when the supplied campaignId is out of
 * scope (caller turns null into a 404).
 */
async function resolveRefCtx(
  campaignId: string | undefined,
  workspaceId: string | undefined,
): Promise<string | null> {
  if (!campaignId) return "";
  if (!workspaceId) return null;

  if (isLocalFirstMode()) {
    const campaign = getLocalCampaign(campaignId, workspaceId);
    if (!campaign) return null;
    const ref = getLocalReferences(campaign.id, workspaceId);
    return buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);
  }

  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
  });
  if (!campaign) return null;

  const ref = await db.query.references.findFirst({
    where: eq(references.campaignId, campaign.id),
  });
  return buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);
}

// POST /api/weave
// Body: { sources:[{name,text}], campaignId? }
//   - default            → run synchronously, return { extracts, brief, mapping, draft }
//   - ?async=1           → kick a background job, return { jobId } (poll GET /api/weave/[id])
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = weaveBodySchema.parse(await req.json());

    // runWeave requires >= 2 usable sources (text > 20 chars after trim). Zod
    // already requires >= 2 sources; enforce the content threshold here so a
    // too-thin payload is a clean 400 rather than the lib throwing a 500.
    const usable = body.sources.filter((s) => (s.text || "").trim().length > 20);
    if (usable.length < 2) {
      return NextResponse.json(
        { error: "Add at least two sources with content to weave.", code: "bad_request" },
        { status: 400 },
      );
    }

    const refCtx = await resolveRefCtx(body.campaignId, user.workspaceId);
    if (refCtx === null) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }

    if (wantsAsync(req)) {
      const job = createJob(user.id);
      // Fire-and-forget; progress + result land in the in-memory job store.
      void runWeave(body.sources, refCtx, getAIForTask("weave"), (p) => setProgress(job.id, p))
        .then((result) => completeJob(job.id, result))
        .catch((err: unknown) =>
          failJob(job.id, err instanceof Error ? err.message : "Weave failed."),
        );
      return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
    }

    const result = await runWeave(body.sources, refCtx, getAIForTask("weave"));
    // { extracts, brief, mapping, draft } (+ generatedAt) — the prototype shape.
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
