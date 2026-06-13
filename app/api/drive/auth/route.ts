import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { consentUrl } from "@/lib/drive";
import { toErrorResponse } from "@/lib/errors";
import { isLocalFirstMode } from "@/lib/local/mode";

/**
 * GET /api/drive/auth — begin the server-side Google OAuth flow.
 *
 * Requires an authenticated caller, builds the offline-access consent URL
 * (access_type:offline + prompt:consent so Google returns a REFRESH token), and
 * redirects the browser to Google. The `state` carries the caller's id +
 * workspace so the callback can persist the refresh token onto the right
 * settings row; the callback ALSO re-checks the live session, so a tampered
 * state cannot bind a token to another user.
 *
 * An optional `?folderId=` query param round-trips the chosen destination folder
 * through state so the callback can store it alongside the token.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();

    const url = new URL(req.url);
    const folderId = url.searchParams.get("folderId") ?? "";

    const state = JSON.stringify({
      uid: user.id,
      wid: user.workspaceId ?? "",
      folderId,
    });

    // Local-first desktop: the server's port is dynamic, so derive the OAuth
    // callback from this request's own origin instead of a fixed env URI. Use a
    // Google "Desktop app" OAuth client — those allow loopback redirects on any
    // port.
    const redirectOverride = isLocalFirstMode()
      ? new URL("/api/drive/auth/callback", url).toString()
      : undefined;

    return NextResponse.redirect(await consentUrl(state, redirectOverride));
  } catch (err) {
    return toErrorResponse(err);
  }
}
