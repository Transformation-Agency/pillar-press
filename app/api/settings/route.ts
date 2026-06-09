import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, settings, type Setting } from "@/lib/db";
import { getOrCreateLocalSettings, updateLocalSettings, type LocalSetting } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { toErrorResponse } from "@/lib/errors";
import {
  updateSettingsSchema,
  type Prefs,
  type SettingsView,
} from "@/lib/schemas-settings";

/**
 * GET/PUT /api/settings — the caller's per-user/workspace settings row.
 *
 * Holds the Drive destination folder id + non-secret UI prefs (theme, active
 * campaign, tweaks). Provider API keys live in server env, NOT here, and the
 * Drive refresh token is a server-only secret that is never returned — we only
 * surface a boolean `driveLinked` so the UI can show link state.
 *
 * The row is created lazily on first GET if absent. Every query is scoped to
 * the caller's user (and workspace when present).
 */

/** Predicate scoping a settings row to this caller. */
function scope(user: { id: string; workspaceId?: string }) {
  return user.workspaceId
    ? and(eq(settings.userId, user.id), eq(settings.workspaceId, user.workspaceId))
    : eq(settings.userId, user.id);
}

/** Project a DB row into the secret-free client view. */
function toView(row: Setting): SettingsView {
  return {
    id: row.id,
    driveFolderId: row.driveFolderId ?? null,
    prefs: (row.prefs as Prefs | null) ?? {},
    driveLinked: Boolean(row.driveRefreshToken),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLocalView(row: LocalSetting): SettingsView {
  return {
    id: row.id,
    driveFolderId: row.driveFolderId ?? null,
    prefs: row.prefs as Prefs,
    driveLinked: Boolean(row.driveRefreshToken),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export async function GET() {
  try {
    const user = await requireUser();
    if (isLocalFirstMode()) {
      return NextResponse.json({
        settings: toLocalView(getOrCreateLocalSettings(user.id, user.workspaceId ?? "local-workspace")),
      });
    }

    const [existing] = await db.select().from(settings).where(scope(user)).limit(1);
    if (existing) return NextResponse.json({ settings: toView(existing) });

    // Create the row on first read.
    const [created] = await db
      .insert(settings)
      .values({
        userId: user.id,
        workspaceId: user.workspaceId,
        prefs: {},
      })
      .returning();

    return NextResponse.json({ settings: toView(created) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const body = updateSettingsSchema.parse(await req.json());
    if (isLocalFirstMode()) {
      const updated = updateLocalSettings(user.id, user.workspaceId ?? "local-workspace", body);
      return NextResponse.json({ settings: toLocalView(updated) });
    }

    // Only the non-secret, client-owned columns may be written here.
    const patch: Partial<Setting> = { updatedAt: new Date() };
    if (body.driveFolderId !== undefined) patch.driveFolderId = body.driveFolderId;
    if (body.prefs !== undefined) patch.prefs = body.prefs;

    const [updated] = await db
      .update(settings)
      .set(patch)
      .where(scope(user))
      .returning();

    if (updated) return NextResponse.json({ settings: toView(updated) });

    // No row yet — create it with the supplied values (upsert-on-first-write).
    const [created] = await db
      .insert(settings)
      .values({
        userId: user.id,
        workspaceId: user.workspaceId,
        driveFolderId: body.driveFolderId ?? null,
        prefs: body.prefs ?? {},
      })
      .returning();

    return NextResponse.json({ settings: toView(created) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
