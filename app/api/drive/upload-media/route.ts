import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser, type SessionUser } from "@/lib/auth";
import { db, mediaJobs, settings } from "@/lib/db";
import { uploadBinaryFile, DriveError } from "@/lib/drive";
import { safeName } from "@/lib/exporters";
import { toErrorResponse } from "@/lib/errors";
import { getLocalMediaJob } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { isLocalStoredUrl, writeLocalPublicFile } from "@/lib/local/storage";

const bodySchema = z.object({ mediaId: z.string().uuid() });

function settingsScope(user: SessionUser) {
  return user.workspaceId
    ? and(eq(settings.userId, user.id), eq(settings.workspaceId, user.workspaceId))
    : eq(settings.userId, user.id);
}

/** [extension, mime] for a media item, preferring the fetched content-type. */
function fileType(kind: string | null | undefined, contentType: string): [string, string] {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
  };
  if (map[ct]) return [map[ct], ct];
  if (kind === "image") return ["png", "image/png"];
  if (kind === "video" || kind === "avatar_video" || kind === "avatar") return ["mp4", "video/mp4"];
  if (kind === "audio") return ["mp3", "audio/mpeg"];
  return ["bin", "application/octet-stream"];
}

/**
 * POST /api/drive/upload-media  { mediaId }
 *
 * Fetch a generated media item's bytes (image / video / audio) and upload them
 * to the caller's linked Google Drive folder (binary). Drive OAuth runs entirely
 * server-side via the refresh token on the caller's settings row.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { mediaId } = bodySchema.parse(await req.json());

    const media = isLocalFirstMode()
      ? getLocalMediaJob(mediaId, user.id)
      : await db.query.mediaJobs.findFirst({
          where: and(eq(mediaJobs.id, mediaId), eq(mediaJobs.userId, user.id)),
        });
    if (!media) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

    const url = media.downloadUrl || media.outputUrl;
    if (!url || media.status !== "completed") {
      return NextResponse.json({ error: "This media isn't ready to save yet.", code: "validation" }, { status: 422 });
    }

    if (isLocalFirstMode() && isLocalStoredUrl(url)) {
      const base = safeName(media.prompt || media.modelName || media.type || "media");
      return NextResponse.json({ file: { id: url, name: base, webViewLink: url } }, { status: 201 });
    }

    const [setting] = isLocalFirstMode()
      ? []
      : await db.select().from(settings).where(settingsScope(user)).limit(1);
    const driveRefreshToken = setting?.driveRefreshToken;
    if (!isLocalFirstMode() && !driveRefreshToken) {
      throw new DriveError("Google Drive is not linked.", 400, "drive_not_linked");
    }

    // Fetch the media bytes (http(s) or a data: URL).
    let bytes: Buffer;
    let contentType = "";
    if (url.startsWith("data:")) {
      contentType = url.slice(5, url.indexOf(";"));
      bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    } else {
      const fetchUrl = url.startsWith("/") ? new URL(url, req.url).toString() : url;
      const r = await fetch(fetchUrl);
      if (!r.ok) throw new DriveError("Couldn't fetch the media file.", 502, "media_fetch_failed");
      contentType = r.headers.get("content-type") || "";
      bytes = Buffer.from(await r.arrayBuffer());
    }

    const [ext, mime] = fileType(media.type, contentType);
    const base = safeName(media.prompt || media.modelName || media.type || "media");
    const name = `${base}-${media.id.slice(0, 8)}.${ext}`;

    if (isLocalFirstMode()) {
      const localUrl = writeLocalPublicFile(bytes, name, mime, "exports");
      return NextResponse.json({ file: { id: localUrl, name, webViewLink: localUrl } }, { status: 201 });
    }

    const file = await uploadBinaryFile(driveRefreshToken!, setting.driveFolderId, name, bytes, mime);
    return NextResponse.json({ file }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
