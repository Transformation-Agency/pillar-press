import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gatherSchedules } from "@/db/gather-schema";
import {
  deleteLocalGatherSchedule,
  listLocalGatherSchedules,
  saveLocalGatherSchedule,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { toErrorResponse } from "@/lib/errors";
import { campaignInWorkspace, tenantNotFound } from "@/lib/tenant";

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
    if (!(await campaignInWorkspace(campaignId, user.workspaceId))) return tenantNotFound();
    if (isLocalFirstMode()) {
      return NextResponse.json({ schedules: listLocalGatherSchedules(campaignId, user.id) });
    }
    const schedules = await db
      .select()
      .from(gatherSchedules)
      .where(
        and(
          eq(gatherSchedules.workspaceId, user.workspaceId!),
          eq(gatherSchedules.userId, user.id),
          eq(gatherSchedules.campaignId, campaignId),
        ),
      )
      .orderBy(asc(gatherSchedules.createdAt));
    return NextResponse.json({ schedules });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = scheduleSchema.parse(await req.json());
    if (!(await campaignInWorkspace(body.campaignId, user.workspaceId))) return tenantNotFound();
    if (isLocalFirstMode()) {
      const schedule = saveLocalGatherSchedule(body, user.id);
      return NextResponse.json({ schedule }, { status: 201 });
    }

    if (body.id) {
      const [anyExisting] = await db
        .select()
        .from(gatherSchedules)
        .where(eq(gatherSchedules.id, body.id))
        .limit(1);
      if (
        anyExisting &&
        (anyExisting.userId !== user.id || anyExisting.workspaceId !== user.workspaceId)
      ) {
        return tenantNotFound();
      }

      if (anyExisting && anyExisting.campaignId !== body.campaignId) return tenantNotFound();
      if (anyExisting) {
        const [schedule] = await db
          .update(gatherSchedules)
          .set({
            campaignId: body.campaignId,
            cadence: body.cadence,
            runAt: body.runAt ?? null,
            timeOfDay: body.timeOfDay ?? null,
            dayOfWeek: body.dayOfWeek ?? null,
            enabled: body.enabled ?? true,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(gatherSchedules.id, body.id),
              eq(gatherSchedules.userId, user.id),
              eq(gatherSchedules.workspaceId, user.workspaceId!),
            ),
          )
          .returning();
        return NextResponse.json({ schedule }, { status: 200 });
      }
    }

    const [schedule] = await db
      .insert(gatherSchedules)
      .values({
        ...(body.id ? { id: body.id } : {}),
        userId: user.id,
        workspaceId: user.workspaceId!,
        campaignId: body.campaignId,
        cadence: body.cadence,
        runAt: body.runAt ?? null,
        timeOfDay: body.timeOfDay ?? null,
        dayOfWeek: body.dayOfWeek ?? null,
        enabled: body.enabled ?? true,
      })
      .returning();
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
    if (isLocalFirstMode()) {
      const deleted = deleteLocalGatherSchedule(id, user.id);
      return NextResponse.json({ deleted });
    }
    if (!user.workspaceId) return tenantNotFound();
    const result = await db
      .delete(gatherSchedules)
      .where(
        and(
          eq(gatherSchedules.id, id),
          eq(gatherSchedules.userId, user.id),
          eq(gatherSchedules.workspaceId, user.workspaceId!),
        ),
      );
    const deleted = (result as { rowCount?: number }).rowCount ?? 0;
    return NextResponse.json({ deleted });
  } catch (err) {
    return toErrorResponse(err);
  }
}
