import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser, assertAuthor } from "@/lib/auth";
import { db, campaigns, references } from "@/lib/db";
import { getLocalCampaign, getLocalReferences, updateLocalReferences } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { putReferencesSchema } from "@/lib/schemas-campaigns";
import { toErrorResponse } from "@/lib/errors";

/**
 * Confirm the campaign exists AND belongs to the given workspace. Returns the
 * campaign id when in-scope, otherwise null (caller turns null into a 404 so we
 * never reveal that a cross-workspace campaign exists).
 */
async function campaignInScope(
  campaignId: string,
  workspaceId: string | undefined,
): Promise<string | null> {
  if (!workspaceId) return null;
  if (isLocalFirstMode()) return getLocalCampaign(campaignId, workspaceId)?.id ?? null;
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

// GET /api/campaigns/:id/references
// Return the campaign's current references document. Scoped by workspace.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const scopedId = await campaignInScope(id, user.workspaceId);
    if (!scopedId) {
      return NextResponse.json(
        { error: "Not found.", code: "not_found" },
        { status: 404 },
      );
    }

    if (isLocalFirstMode()) {
      const ref = getLocalReferences(scopedId, user.workspaceId);
      if (!ref) {
        return NextResponse.json(
          { error: "Not found.", code: "not_found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ references: ref });
    }

    const ref = await db.query.references.findFirst({
      where: eq(references.campaignId, scopedId),
    });
    if (!ref) {
      return NextResponse.json(
        { error: "Not found.", code: "not_found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ references: ref });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PUT /api/campaigns/:id/references  { doc } | { patch }
// Replace (`doc`) or shallow-merge (`patch`) the references document.
// AUTHOR ONLY — assistants get 403 (they may not edit References).
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Authorize role first: assistants are forbidden from writing references.
    const user = await assertAuthor();
    const { id } = await params;

    const scopedId = await campaignInScope(id, user.workspaceId);
    if (!scopedId) {
      return NextResponse.json(
        { error: "Not found.", code: "not_found" },
        { status: 404 },
      );
    }

    const body = putReferencesSchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const updated = updateLocalReferences(scopedId, body, user.workspaceId);
      if (!updated) {
        return NextResponse.json(
          { error: "Not found.", code: "not_found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ references: updated });
    }

    const existing = await db.query.references.findFirst({
      where: eq(references.campaignId, scopedId),
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Not found.", code: "not_found" },
        { status: 404 },
      );
    }

    // `doc` replaces the whole document; `patch` shallow-merges into it
    // (mirrors store.js updateReferences()).
    const nextDoc =
      body.doc !== undefined
        ? body.doc
        : { ...(existing.doc as Record<string, unknown>), ...body.patch };

    const [updated] = await db
      .update(references)
      .set({ doc: nextDoc, updatedAt: new Date() })
      .where(eq(references.campaignId, scopedId))
      .returning();

    return NextResponse.json({ references: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
