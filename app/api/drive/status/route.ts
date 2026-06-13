import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, settings } from "@/lib/db";
import { driveOauthConfigured, folderName } from "@/lib/drive";
import { toErrorResponse } from "@/lib/errors";
import { getOrCreateLocalSettings } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";

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

    if (isLocalFirstMode()) {
      const row = getOrCreateLocalSettings(user.id, user.workspaceId ?? "local-workspace");
      const linked = Boolean(row.driveRefreshToken);
      let name: string | null = null;
      if (linked && row.driveFolderId) {
        name = await folderName(row.driveRefreshToken!, row.driveFolderId).catch(() => null);
      }
      return NextResponse.json({
        linked,
        folderId: row.driveFolderId,
        folderName: name ?? (row.driveFolderId && !linked ? "Local exports" : name),
        localExportAvailable: true,
        oauthConfigured: driveOauthConfigured(),
      });
    }

    const [row] = await db.select().from(settings).where(scope(user)).limit(1);

    const linked = Boolean(row?.driveRefreshToken);
    const folderId = row?.driveFolderId ?? null;

    let name: string | null = null;
    if (linked && folderId) {
      name = await folderName(row!.driveRefreshToken!, folderId);
    }

    return NextResponse.json({ linked, folderId, folderName: name, oauthConfigured: driveOauthConfigured() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
