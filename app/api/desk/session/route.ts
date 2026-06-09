import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db, settings, type Setting } from "@/lib/db";
import {
  getLocalDeskSession,
  updateLocalDeskSession,
  type LocalDeskSession,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { toErrorResponse } from "@/lib/errors";

const deskSessionSchema = z.object({
  activeId: z.string().nullable().optional(),
  state: z.record(z.unknown()),
});

function localView(row: LocalDeskSession) {
  return {
    id: row.id,
    activeId: row.activeId,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function settingsScope(user: { id: string; workspaceId?: string }) {
  return user.workspaceId
    ? and(eq(settings.userId, user.id), eq(settings.workspaceId, user.workspaceId))
    : eq(settings.userId, user.id);
}

async function hostedSettings(user: { id: string; workspaceId?: string }): Promise<Setting> {
  const [existing] = await db.select().from(settings).where(settingsScope(user)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(settings)
    .values({ userId: user.id, workspaceId: user.workspaceId, prefs: {} })
    .returning();
  return created;
}

export async function GET() {
  try {
    const user = await requireUser();
    if (isLocalFirstMode()) {
      return NextResponse.json({ session: localView(getLocalDeskSession(user.id, user.workspaceId ?? "local-workspace")) });
    }

    const row = await hostedSettings(user);
    const prefs = (row.prefs as Record<string, unknown> | null) ?? {};
    const session = (prefs.deskSession && typeof prefs.deskSession === "object")
      ? (prefs.deskSession as Record<string, unknown>)
      : {};
    return NextResponse.json({
      session: {
        id: "settings-desk-session",
        activeId: typeof session.activeId === "string" ? session.activeId : null,
        state: session.state && typeof session.state === "object" ? session.state : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const body = deskSessionSchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const updated = updateLocalDeskSession(user.id, user.workspaceId ?? "local-workspace", body);
      return NextResponse.json({ session: localView(updated) });
    }

    const row = await hostedSettings(user);
    const prefs = (row.prefs as Record<string, unknown> | null) ?? {};
    const nextPrefs = {
      ...prefs,
      deskSession: {
        activeId: body.activeId ?? null,
        state: body.state,
      },
    };
    const [updated] = await db
      .update(settings)
      .set({ prefs: nextPrefs, updatedAt: new Date() })
      .where(settingsScope(user))
      .returning();

    return NextResponse.json({
      session: {
        id: "settings-desk-session",
        activeId: body.activeId ?? null,
        state: body.state,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
