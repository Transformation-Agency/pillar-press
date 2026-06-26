import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, campaigns, letterWorkflows, pieces, references } from "@/lib/db";
import {
  createLocalPiece,
  getLocalLetterWorkflow,
  getLocalPiece,
  getLocalReferences,
  updateLocalLetterWorkflow,
  updateLocalPiece,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { getAIForTaskForUser } from "@/lib/llm";
import { buildRefContext, type ReferencesDoc } from "@/lib/refContext";
import { completeUsageReservation, failUsageReservation, reserveUsage, type UsageReservation } from "@/lib/billing/usage";
import { generateLetterDraft } from "@/lib/letters/draft";
import { letterDraftSchema } from "@/lib/schemas-letters";
import { toErrorResponse } from "@/lib/errors";

const notFound = () => NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

function recipientName(workflow: { recipientSnapshot?: unknown }) {
  const snapshot = workflow.recipientSnapshot && typeof workflow.recipientSnapshot === "object"
    ? workflow.recipientSnapshot as Record<string, unknown>
    : {};
  return typeof snapshot.displayName === "string" && snapshot.displayName.trim()
    ? snapshot.displayName.trim()
    : "recipient";
}

async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let reservation: UsageReservation = null;
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!user.workspaceId) return notFound();
    const body = letterDraftSchema.parse(await readBody(req));

    if (isLocalFirstMode()) {
      const workflow = getLocalLetterWorkflow(id, user.id, user.workspaceId);
      if (!workflow) return notFound();
      const refs = getLocalReferences(workflow.campaignId, user.workspaceId);
      const refContext = buildRefContext((refs?.doc as ReferencesDoc | undefined) ?? null);
      const taskAI = await getAIForTaskForUser("draft", user);
      reservation = await reserveUsage({
        user,
        task: "utility",
        feature: "letters.draft",
        campaignId: workflow.campaignId,
        providerSource: taskAI.providerSource,
        provider: taskAI.provider,
        model: taskAI.model,
        metadata: taskAI.profileId ? { profileId: taskAI.profileId } : {},
        estimatedCredits: Math.max(1, Math.ceil(JSON.stringify(workflow).length / 12000)),
      });
      const draft = await generateLetterDraft(taskAI.ai, { workflow, refContext });
      const title = `Letter to ${recipientName(workflow)}`;
      const categoryContext = {
        letterWorkflowId: workflow.id,
        recipientId: workflow.recipientId ?? null,
        recipientName: recipientName(workflow),
        recipientSnapshot: workflow.recipientSnapshot ?? {},
        relationshipNotes: (workflow.recipientSnapshot as any)?.relationship ?? null,
        toneGuidance: workflow.tone ?? (workflow.recipientSnapshot as any)?.defaultTone ?? null,
        desiredOutcome: workflow.desiredOutcome ?? null,
        occasion: workflow.occasion ?? null,
        constraints: workflow.constraints ?? null,
      };
      const existingPiece = workflow.pieceId ? getLocalPiece(workflow.pieceId, user.id, user.workspaceId) : null;
      const piece = existingPiece && body.refreshPiece
        ? updateLocalPiece(existingPiece.id, user.id, { title, original: draft, status: "Draft", category: "letter", categoryContext }, user.workspaceId)
        : createLocalPiece({ campaignId: workflow.campaignId, userId: user.id, title, original: draft, category: "letter", categoryContext }, user.workspaceId);
      if (!piece) return notFound();
      const updated = updateLocalLetterWorkflow(id, user.id, user.workspaceId, {
        pieceId: piece.id,
        status: "drafted",
      });
      await completeUsageReservation(reservation, {
        actualCredits: Math.max(1, Math.ceil((JSON.stringify(workflow).length + draft.length) / 12000)),
      });
      return NextResponse.json({ workflow: updated, piece });
    }

    const workflow = await db.query.letterWorkflows.findFirst({
      where: and(eq(letterWorkflows.id, id), eq(letterWorkflows.userId, user.id), eq(letterWorkflows.workspaceId, user.workspaceId)),
    });
    if (!workflow) return notFound();
    const campaign = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.id, workflow.campaignId), eq(campaigns.workspaceId, user.workspaceId)),
    });
    if (!campaign) return notFound();
    const ref = await db.query.references.findFirst({ where: eq(references.campaignId, campaign.id) });
    const refContext = buildRefContext((ref?.doc as ReferencesDoc | undefined) ?? null);
    const taskAI = await getAIForTaskForUser("draft", user);
    reservation = await reserveUsage({
      user,
      task: "utility",
      feature: "letters.draft",
      campaignId: campaign.id,
      providerSource: taskAI.providerSource,
      provider: taskAI.provider,
      model: taskAI.model,
      metadata: taskAI.profileId ? { profileId: taskAI.profileId } : {},
      estimatedCredits: Math.max(1, Math.ceil(JSON.stringify(workflow).length / 12000)),
    });
    const draft = await generateLetterDraft(taskAI.ai, {
      workflow: {
        ...workflow,
        recipientSnapshot: workflow.recipientSnapshot && typeof workflow.recipientSnapshot === "object"
          ? workflow.recipientSnapshot as Record<string, unknown>
          : {},
        uploads: Array.isArray(workflow.uploads) ? workflow.uploads : [],
      },
      refContext,
    });
    const title = `Letter to ${recipientName(workflow)}`;
    const recipientSnapshot = workflow.recipientSnapshot && typeof workflow.recipientSnapshot === "object"
      ? workflow.recipientSnapshot as Record<string, unknown>
      : {};
    const categoryContext = {
      letterWorkflowId: workflow.id,
      recipientId: workflow.recipientId ?? null,
      recipientName: recipientName(workflow),
      recipientSnapshot,
      relationshipNotes: (recipientSnapshot as any).relationship ?? null,
      toneGuidance: workflow.tone ?? (recipientSnapshot as any).defaultTone ?? null,
      desiredOutcome: workflow.desiredOutcome ?? null,
      occasion: workflow.occasion ?? null,
      constraints: workflow.constraints ?? null,
    };
    const existingPiece = workflow.pieceId
      ? await db.query.pieces.findFirst({
        where: and(eq(pieces.id, workflow.pieceId), eq(pieces.userId, user.id), eq(pieces.campaignId, campaign.id)),
      })
      : null;
    const [piece] = existingPiece && body.refreshPiece
      ? await db
        .update(pieces)
        .set({ title, original: draft, status: "Draft", category: "letter", categoryContext, updatedAt: new Date() })
        .where(and(eq(pieces.id, existingPiece.id), eq(pieces.userId, user.id)))
        .returning()
      : await db
        .insert(pieces)
        .values({ campaignId: campaign.id, userId: user.id, title, original: draft, status: "Draft", category: "letter", categoryContext })
        .returning();
    const [updated] = await db
      .update(letterWorkflows)
      .set({ pieceId: piece.id, status: "drafted", updatedAt: new Date() })
      .where(and(eq(letterWorkflows.id, workflow.id), eq(letterWorkflows.userId, user.id), eq(letterWorkflows.workspaceId, user.workspaceId)))
      .returning();
    await completeUsageReservation(reservation, {
      actualCredits: Math.max(1, Math.ceil((JSON.stringify(workflow).length + draft.length) / 12000)),
    });
    return NextResponse.json({ workflow: updated, piece });
  } catch (err) {
    await failUsageReservation(reservation, err);
    return toErrorResponse(err);
  }
}
