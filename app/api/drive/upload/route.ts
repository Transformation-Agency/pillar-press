import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser, type SessionUser } from "@/lib/auth";
import { db, campaigns, pieces, settings, type Piece } from "@/lib/db";
import {
  outputMarkdown,
  pieceOutputsMarkdown,
  safeName,
  type OutputObject,
  type PieceForExport,
} from "@/lib/exporters";
import { uploadMany, DriveError } from "@/lib/drive";
import { driveUploadSchema, driveUploadFilesSchema } from "@/lib/schemas-drive";
import { toErrorResponse } from "@/lib/errors";

/**
 * POST /api/drive/upload — build platform-output markdown for a piece and upload
 * it to the caller's linked Google Drive folder.
 *
 * Body: { pieceId, scope:'one'|'all', platform? }
 *   - scope:'all' → one combined document of every output (pieceOutputsMarkdown)
 *   - scope:'one' → the single `platform` output (outputMarkdown)
 *
 * The markdown is built VERBATIM via lib/exporters.ts (the same structure as the
 * client `.md`/`.zip` download path). Drive OAuth runs entirely server-side
 * using the refresh token stored on the caller's settings row. Returns the
 * created Drive file links.
 */

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

/** Scope a settings row to this caller. */
function settingsScope(user: SessionUser) {
  return user.workspaceId
    ? and(eq(settings.userId, user.id), eq(settings.workspaceId, user.workspaceId))
    : eq(settings.userId, user.id);
}

/**
 * Load a piece the caller owns within their workspace, or null (→ 404, never
 * revealing existence). Mirrors app/api/pieces/[id]/route.ts#resolvePiece.
 */
async function resolvePiece(id: string, user: SessionUser): Promise<Piece | null> {
  const piece = await db.query.pieces.findFirst({
    where: and(eq(pieces.id, id), eq(pieces.userId, user.id)),
  });
  if (!piece) return null;
  if (!user.workspaceId) return null;

  const campaign = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, piece.campaignId), eq(campaigns.workspaceId, user.workspaceId)),
  });
  if (!campaign) return null;

  return piece;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const raw: unknown = await req.json();

    // 1) Ensure Drive is linked for this caller. (Shared by both modes.)
    const [setting] = await db.select().from(settings).where(settingsScope(user)).limit(1);
    if (!setting?.driveRefreshToken) {
      throw new DriveError("Google Drive is not linked.", 400, "drive_not_linked");
    }

    // Mode A — prebuilt files: { files:[{name,content,mime?}] } uploaded as-is.
    if (raw && typeof raw === "object" && "files" in raw) {
      const { files } = driveUploadFilesSchema.parse(raw);
      const uploaded = await uploadMany(
        setting.driveRefreshToken,
        setting.driveFolderId,
        files,
      );
      return NextResponse.json({ files: uploaded }, { status: 201 });
    }

    // Mode B — piece export: build markdown server-side from a piece's outputs.
    const body = driveUploadSchema.parse(raw);

    // 2) Load the piece (ownership-scoped → 404 on miss).
    const piece = await resolvePiece(body.pieceId, user);
    if (!piece) return notFound();

    const outputs = (piece.outputs as Record<string, OutputObject> | null) ?? {};
    const outputOrder = (piece.outputOrder as string[] | null) ?? [];

    if (Object.keys(outputs).length === 0) {
      throw new DriveError("This piece has no platform outputs to export.", 422, "no_outputs");
    }

    // 3) Build the markdown file(s) via the verbatim exporters.
    const files: { name: string; content: string; mime: string }[] = [];
    if (body.scope === "one") {
      const o = outputs[body.platform!];
      if (!o) {
        throw new DriveError("That platform has no output on this piece.", 404, "no_platform_output");
      }
      files.push({
        name: `${safeName(piece.title)}-${safeName(o.platform || body.platform!)}.md`,
        content: outputMarkdown(o),
        mime: "text/markdown",
      });
    } else {
      const pieceForExport: PieceForExport = {
        title: piece.title,
        outputs,
        outputOrder,
      };
      files.push({
        name: `${safeName(piece.title)}-all-outputs.md`,
        content: pieceOutputsMarkdown(pieceForExport),
        mime: "text/markdown",
      });
    }

    // 4) Upload to the linked folder (server-side OAuth).
    const uploaded = await uploadMany(
      setting.driveRefreshToken,
      setting.driveFolderId,
      files,
    );

    return NextResponse.json({ files: uploaded }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
