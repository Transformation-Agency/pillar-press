import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  listEnabledLocalGatherSchedules,
  markLocalGatherScheduleRun,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { runGatherForCampaign } from "@/lib/gather/runCampaign";
import { isGatherScheduleDue } from "@/lib/gather/scheduleDue";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

let running = false;

export async function POST() {
  try {
    if (!isLocalFirstMode()) {
      return NextResponse.json({ error: "Scheduled Gather runs are local-first only.", code: "local_first" }, { status: 400 });
    }

    const user = await requireUser();
    if (running) return NextResponse.json({ ran: 0, skipped: true, results: [] });

    running = true;
    try {
      const due = listEnabledLocalGatherSchedules(user.id).filter((schedule) => isGatherScheduleDue(schedule));
      const results = [];
      for (const schedule of due) {
        try {
          const result = await runGatherForCampaign(schedule.campaignId, user);
          if (!result) {
            markLocalGatherScheduleRun(schedule.id, "not_found", user.id, schedule.cadence === "once");
            results.push({ id: schedule.id, campaignId: schedule.campaignId, status: "not_found" });
            continue;
          }
          markLocalGatherScheduleRun(schedule.id, "ok", user.id, schedule.cadence === "once");
          results.push({
            id: schedule.id,
            campaignId: schedule.campaignId,
            status: "ok",
            found: result.found,
            saved: result.saved,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "failed";
          markLocalGatherScheduleRun(schedule.id, message.slice(0, 160), user.id, schedule.cadence === "once");
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
