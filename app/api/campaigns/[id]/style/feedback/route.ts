import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assertAuthor } from "@/lib/auth";
import { db, campaigns, references } from "@/lib/db";
import { styleProfiles, styleFeedback } from "@/db/style-schema";
import { refineStyleDirective, normalizeKnobs } from "@/lib/ai/style";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { getAIForTask } from "@/lib/llm";
import { toErrorResponse } from "@/lib/errors";
import {
  createLocalStyleFeedback,
  getLocalCampaign,
  getLocalReferences,
  getLocalStyleProfile,
  upsertLocalStyleProfile,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";

// Knob values are validated loosely then clamped by normalizeKnobs.
const bodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  knobs: z.object({
    palette: z.string(),
    mood: z.string(),
    finish: z.string(),
    detail: z.string(),
  }),
  working: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
  mediaJobId: z.string().uuid().optional(),
});

// POST /api/campaigns/[id]/style/feedback — author-only. Refines the evolving
// directive from the prior profile + this rating, upserts the profile (knobs +
// directive, rounds+1), logs a feedback row, returns the updated profile.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await assertAuthor();
    const { id } = await params;

    if (!user.workspaceId) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    const campaign = isLocalFirstMode()
      ? getLocalCampaign(id, user.workspaceId)
      : await db.query.campaigns.findFirst({
          where: and(eq(campaigns.id, id), eq(campaigns.workspaceId, user.workspaceId)),
        });
    if (!campaign) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

    const body = bodySchema.parse(await req.json());
    const knobs = normalizeKnobs(body.knobs);

    const current = isLocalFirstMode()
      ? getLocalStyleProfile(id, user.workspaceId)
      : await db.query.styleProfiles.findFirst({ where: eq(styleProfiles.campaignId, id) });

    const ref = isLocalFirstMode()
      ? getLocalReferences(id, user.workspaceId)
      : await db.query.references.findFirst({ where: eq(references.campaignId, id) });
    const refCtx = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);

    const directive = await refineStyleDirective(
      current ? { directive: current.directive } : null,
      { rating: body.rating, knobs, working: body.working, notes: body.notes },
      refCtx,
      getAIForTask("utility"),
    );
    const rounds = (current?.rounds ?? 0) + 1;

    let profile;
    if (isLocalFirstMode()) {
      profile = upsertLocalStyleProfile({ campaignId: id, userId: user.id, knobs, directive, rounds }, user.workspaceId);
    } else if (current) {
      [profile] = await db
        .update(styleProfiles)
        .set({ knobs, directive, rounds, userId: user.id, updatedAt: new Date() })
        .where(eq(styleProfiles.campaignId, id))
        .returning();
    } else {
      [profile] = await db
        .insert(styleProfiles)
        .values({ campaignId: id, userId: user.id, knobs, directive, rounds })
        .returning();
    }

    if (isLocalFirstMode()) {
      createLocalStyleFeedback({
        campaignId: id,
        mediaJobId: body.mediaJobId,
        rating: body.rating,
        knobs,
        working: body.working,
        notes: body.notes,
      }, user.workspaceId);
    } else {
      await db.insert(styleFeedback).values({
        campaignId: id,
        mediaJobId: body.mediaJobId,
        rating: body.rating,
        knobs,
        working: body.working,
        notes: body.notes,
      });
    }

    if (!profile) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    return NextResponse.json({ knobs: profile.knobs, directive: profile.directive, rounds: profile.rounds });
  } catch (err) {
    return toErrorResponse(err);
  }
}
