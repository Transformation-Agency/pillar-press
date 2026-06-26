import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gatherSchedules } from "@/db/gather-schema";
import {
  listEnabledLocalGatherSchedules,
  markLocalGatherScheduleRun,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { runGatherForCampaign } from "@/lib/gather/runCampaign";
import { isGatherScheduleDue } from "@/lib/gather/scheduleDue";
import { toErrorResponse } from "@/lib/errors";
import { tenantNotFound } from "@/lib/tenant";
import { completeUsageReservation, failUsageReservation, reserveUsage, type UsageReservation } from "@/lib/billing/usage";
import { getAIForTaskForUser } from "@/lib/llm";

export const runtime = "nodejs";
// A due run covers a whole campaign (every enabled source + its LLM brief),
// which can be slow on local models — match the run route's headroom.
export const maxDuration = 300;

let running = false;

export async function POST() {
  try {
    const user = await requireUser();
    if (!isLocalFirstMode() && !user.workspaceId) return tenantNotFound();
    if (running) return NextResponse.json({ ran: 0, skipped: true, results: [] });

    running = true;
    try {
      const schedules = isLocalFirstMode()
        ? listEnabledLocalGatherSchedules(user.id)
        : await db
          .select()
          .from(gatherSchedules)
          .where(
            and(
              eq(gatherSchedules.workspaceId, user.workspaceId!),
              eq(gatherSchedules.userId, user.id),
              eq(gatherSchedules.enabled, true),
            ),
          )
          .orderBy(asc(gatherSchedules.createdAt));
      const due = schedules.filter((schedule) => isGatherScheduleDue(schedule));
      const results = [];
      for (const schedule of due) {
        let reservation: UsageReservation = null;
        try {
          const taskAI = await getAIForTaskForUser("gather", user);
          const metadata = {
            scheduleId: schedule.id,
            providerSource: taskAI.providerSource,
            ...(taskAI.profileId ? { profileId: taskAI.profileId } : {}),
          };
          reservation = await reserveUsage({
            user,
            task: "gather",
            feature: "gather.schedule.run_due",
            campaignId: schedule.campaignId,
            providerSource: taskAI.providerSource,
            provider: taskAI.provider,
            model: taskAI.model,
            metadata,
          });
          const result = await runGatherForCampaign(schedule.campaignId, user, taskAI.ai);
          if (!result) {
            await failUsageReservation(reservation, new Error("Scheduled Gather campaign was not found."));
            await markScheduleRun(schedule.id, "not_found", user, schedule.cadence === "once");
            results.push({ id: schedule.id, campaignId: schedule.campaignId, status: "not_found" });
            continue;
          }
          await completeUsageReservation(reservation, {
            actualCredits: 1,
            metadata: { ...metadata, found: result.found, saved: result.saved },
          });
          await markScheduleRun(schedule.id, "ok", user, schedule.cadence === "once");
          results.push({
            id: schedule.id,
            campaignId: schedule.campaignId,
            status: "ok",
            found: result.found,
            saved: result.saved,
          });
        } catch (err) {
          await failUsageReservation(reservation, err);
          const message = err instanceof Error ? err.message : "failed";
          await markScheduleRun(schedule.id, message.slice(0, 160), user, schedule.cadence === "once");
          results.push({ id: schedule.id, campaignId: schedule.campaignId, status: "failed", error: message });
        }
      }
      return NextResponse.json({ ran: results.length, results });
    } finally {
      running = false;
    }
  } catch (err) {
    running = false;
    return toErrorResponse(err);
  }
}

async function markScheduleRun(
  id: string,
  status: string,
  user: { id: string; workspaceId?: string | null },
  disable: boolean,
) {
  if (isLocalFirstMode()) {
    markLocalGatherScheduleRun(id, status, user.id, disable);
    return;
  }
  if (!user.workspaceId) return;
  const set: Partial<typeof gatherSchedules.$inferInsert> = {
    lastRunAt: new Date().toISOString(),
    lastStatus: status,
    updatedAt: new Date(),
  };
  if (disable) set.enabled = false;
  await db
    .update(gatherSchedules)
    .set(set)
    .where(
      and(
        eq(gatherSchedules.id, id),
        eq(gatherSchedules.userId, user.id),
        eq(gatherSchedules.workspaceId, user.workspaceId),
      ),
    );
}
