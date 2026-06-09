import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  deleteLocalGatherSchedule,
  listLocalGatherSchedules,
  saveLocalGatherSchedule,
} from "@/lib/local/database";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

const scheduleSchema = z.object({
  id: z.string().optional(),
  campaignId: z.string().min(1),
  cadence: z.enum(["once", "daily", "weekly"]),
  runAt: z.string().nullable().optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const campaignId = new URL(req.url).searchParams.get("campaignId");
    if (!campaignId) {
      return NextResponse.json({ error: "Missing campaignId.", code: "bad_request" }, { status: 400 });
    }
    return NextResponse.json({ schedules: listLocalGatherSchedules(campaignId, user.id) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = scheduleSchema.parse(await req.json());
    const schedule = saveLocalGatherSchedule(body, user.id);
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id.", code: "bad_request" }, { status: 400 });
    }
    const deleted = deleteLocalGatherSchedule(id, user.id);
    return NextResponse.json({ deleted });
  } catch (err) {
    return toErrorResponse(err);
  }
}
