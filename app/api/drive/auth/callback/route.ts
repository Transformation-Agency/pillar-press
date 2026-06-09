import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, settings, type Setting } from "@/lib/db";
import { exchangeCode, DriveError } from "@/lib/drive";
import { toErrorResponse } from "@/lib/errors";
import { isLocalFirstMode } from "@/lib/local/mode";

/**
 * GET /api/drive/auth/callback — Google redirects here after consent.
 *
 * Exchanges the authorization `code` for a REFRESH token and persists it (plus
 * the destination folder id round-tripped through `state`) onto the caller's
 * settings row. The refresh token is a server-only secret — it is written to the
 * DB column and never returned to the client.
 *
 * Security: we DON'T trust `state` for identity. The persisted row is scoped to
 * the LIVE authenticated session (requireUser), so a forged/replayed state
 * cannot attach a token to a different account. We only read the optional
 * folderId out of state as a convenience.
 */

function scopeFor(user: { id: string; workspaceId?: string }) {
  return user.workspaceId
    ? and(eq(settings.userId, user.id), eq(settings.workspaceId, user.workspaceId))
    : eq(settings.userId, user.id);
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();

    if (isLocalFirstMode()) {
      return NextResponse.json(
        { error: "Google Drive linking is disabled in local-first desktop mode. Use local exports instead.", code: "local_first" },
        { status: 400 },
      );
    }

    const url = new URL(req.url);
    const error = url.searchParams.get("error");
    if (error) {
      throw new DriveError("Google Drive authorization was denied.", 400, "drive_denied");
    }

    const code = url.searchParams.get("code");
    if (!code) {
      throw new DriveError("Missing authorization code.", 400, "drive_no_code");
    }

    // Optional destination folder round-tripped through state.
    let folderId = "";
    const rawState = url.searchParams.get("state");
    if (rawState) {
      try {
        const parsed = JSON.parse(rawState) as { folderId?: string };
        folderId = parsed.folderId ?? "";
      } catch {
        // Ignore malformed state — identity comes from the live session anyway.
      }
    }

    const { refreshToken } = await exchangeCode(code);
    if (!refreshToken) {
      // Google omits the refresh token if the user previously consented and we
      // didn't force prompt:consent. consentUrl() forces it, so this is rare.
      throw new DriveError(
        "Google did not return a refresh token. Please re-link Drive.",
        502,
        "drive_no_refresh_token",
      );
    }

    const patch: Partial<Setting> = {
      driveRefreshToken: refreshToken,
      updatedAt: new Date(),
    };
    if (folderId) patch.driveFolderId = folderId;

    const [updated] = await db
      .update(settings)
      .set(patch)
      .where(scopeFor(user))
      .returning();

    if (!updated) {
      await db.insert(settings).values({
        userId: user.id,
        workspaceId: user.workspaceId,
        driveRefreshToken: refreshToken,
        driveFolderId: folderId || null,
        prefs: {},
      });
    }

    // Bounce back to the app. Keep it generic so we don't depend on a route.
    const appBase = process.env.APP_BASE_URL || url.origin;
    return NextResponse.redirect(`${appBase}/?drive=linked`);
  } catch (err) {
    return toErrorResponse(err);
  }
}
