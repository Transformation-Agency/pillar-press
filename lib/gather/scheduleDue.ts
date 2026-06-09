import type { LocalGatherSchedule } from "@/lib/local/database";

function sameLocalDay(a: string | null | undefined, b: Date): boolean {
  if (!a) return false;
  const da = new Date(a);
  return da.getFullYear() === b.getFullYear() && da.getMonth() === b.getMonth() && da.getDate() === b.getDate();
}

function timeToday(time: string | null | undefined, now: Date): Date {
  const d = new Date(now);
  const match = String(time || "08:00").match(/^(\d{2}):(\d{2})$/);
  d.setHours(match ? Number(match[1]) : 8, match ? Number(match[2]) : 0, 0, 0);
  return d;
}

export function isGatherScheduleDue(schedule: LocalGatherSchedule, now = new Date()): boolean {
  if (!schedule.enabled) return false;
  if (schedule.cadence === "once") {
    return !!schedule.runAt && new Date(schedule.runAt).getTime() <= now.getTime() && !schedule.lastRunAt;
  }
  if (schedule.cadence === "daily") {
    return timeToday(schedule.timeOfDay, now).getTime() <= now.getTime() && !sameLocalDay(schedule.lastRunAt, now);
  }
  if (schedule.cadence === "weekly") {
    return now.getDay() === Number(schedule.dayOfWeek) &&
      timeToday(schedule.timeOfDay, now).getTime() <= now.getTime() &&
      !sameLocalDay(schedule.lastRunAt, now);
  }
  return false;
}
