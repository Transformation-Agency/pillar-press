import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, settings } from "@/lib/db";
import { folderName } from "@/lib/drive";
import { toErrorResponse } from "@/lib/errors";

/**
 * GET /api/drive/status — report whether the caller has linked Google Drive and,
 * if a destination folder is set, its display name.
 *
 * The refresh token itself is a server-only secret and is NEVER returned; we
 * surface only a `linked` boolean derived from its presence, plus the folder id
 * and resolved folder name (best-effort — null if the folder was deleted or
 * access was revoked).
 */

/** Predicate scoping a settings row to this caller. */
function scope(user: { id: string; workspaceId?: string }) {
  return user.workspaceId
    ? and(eq(settings.userId, user.id), eq(settings.workspaceId, user.workspaceId))
    : eq(settings.userId, user.id);
}

export async function GET() {
  try {
    const user = await requireUser();

    const [row] = await db.select().from(settings).where(scope(user)).limit(1);

    const linked = Boolean(row?.driveRefreshToken);
    const folderId = row?.driveFolderId ?? null;

    let name: string | null = null;
    if (linked && folderId) {
      name = await folderName(row!.driveRefreshToken!, folderId);
    }

    return NextResponse.json({ linked, folderId, folderName: name });
  } catch (err) {
    return toErrorResponse(err);
  }
}
