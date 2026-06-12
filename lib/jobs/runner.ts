import {
  claimNextBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  type BackgroundJobKind,
} from "@/lib/jobs/background";
import { runGatherForCampaign } from "@/lib/gather/runCampaign";
import { getAIForTaskForUser } from "@/lib/llm";
import {
  completeUsageReservation,
  failUsageReservation,
  reserveUsage,
  type UsageReservation,
} from "@/lib/billing/usage";
import type { BackgroundJob } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

export type RunBackgroundJobInput = {
  workerId: string;
  kinds?: BackgroundJobKind[];
};

export type RunBackgroundJobResult = {
  claimed: boolean;
  jobId?: string;
  kind?: BackgroundJobKind;
  status: "idle" | "succeeded" | "failed" | "requeued";
  result?: unknown;
  error?: string;
};

const DEFAULT_KINDS: BackgroundJobKind[] = ["gather_run"];

function payloadObject(job: BackgroundJob) {
  return job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? job.payload as Record<string, unknown>
    : {};
}

function jobError(code: string, message: string) {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  return err;
}

function userForJob(job: BackgroundJob): SessionUser {
  if (!job.userId) throw jobError("background_job_user_missing", "Background job is missing a user id.");
  return { id: job.userId, workspaceId: job.workspaceId, role: "author" };
}

function campaignIdForJob(job: BackgroundJob) {
  const payload = payloadObject(job);
  const campaignId = job.campaignId ?? (typeof payload.campaignId === "string" ? payload.campaignId : null);
  if (!campaignId) throw jobError("background_job_campaign_missing", "Gather job is missing a campaign id.");
  return campaignId;
}

async function runGatherJob(job: BackgroundJob) {
  const user = userForJob(job);
  const campaignId = campaignIdForJob(job);
  const taskAI = await getAIForTaskForUser("gather", user);
  let reservation: UsageReservation = null;
  try {
    reservation = await reserveUsage({
      user,
      task: "gather",
      feature: "jobs.gather_run",
      campaignId,
      idempotencyKey: `background:${job.id}:gather`,
      providerSource: taskAI.providerSource,
      provider: taskAI.provider,
      model: taskAI.model,
      metadata: {
        backgroundJobId: job.id,
        ...(taskAI.profileId ? { profileId: taskAI.profileId } : {}),
      },
    });
    const result = await runGatherForCampaign(campaignId, user, taskAI.ai);
    if (!result) throw jobError("background_job_not_found", "Gather campaign was not found.");
    await completeUsageReservation(reservation, {
      actualCredits: 1,
      metadata: {
        backgroundJobId: job.id,
        found: result.found,
        saved: result.saved,
      },
    });
    return {
      found: result.found,
      saved: result.saved,
      sourceCount: Object.keys(result.perSource ?? {}).length,
      summaryCount: result.summaries?.length ?? 0,
    };
  } catch (err) {
    await failUsageReservation(reservation, err);
    throw err;
  }
}

async function runClaimedJob(job: BackgroundJob) {
  if (job.kind === "gather_run") return runGatherJob(job);
  throw jobError("background_job_kind_unsupported", `No worker is registered for ${job.kind}.`);
}

export async function runNextBackgroundJob(input: RunBackgroundJobInput): Promise<RunBackgroundJobResult> {
  const job = await claimNextBackgroundJob({
    workerId: input.workerId,
    kinds: input.kinds?.length ? input.kinds : DEFAULT_KINDS,
  });
  if (!job) return { claimed: false, status: "idle" };
  try {
    const result = await runClaimedJob(job);
    await completeBackgroundJob(job, result);
    return { claimed: true, jobId: job.id, kind: job.kind, status: "succeeded", result };
  } catch (err) {
    const updated = await failBackgroundJob(job, err);
    const status = updated?.status === "failed" ? "failed" : "requeued";
    const message = err instanceof Error ? err.message : "Background job failed.";
    return { claimed: true, jobId: job.id, kind: job.kind, status, error: message };
  }
}
