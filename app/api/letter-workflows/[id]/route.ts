import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, letterRecipients, letterWorkflows } from "@/lib/db";
import {
  deleteLocalLetterWorkflow,
  getLocalLetterRecipient,
  getLocalLetterWorkflow,
  updateLocalLetterWorkflow,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { letterWorkflowUpdateSchema } from "@/lib/schemas-letters";
import { toErrorResponse } from "@/lib/errors";

const notFound = () => NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

function recipientSnapshot(recipient: any) {
  if (!recipient) return {};
  return {
    id: recipient.id,
    displayName: recipient.displayName,
    sortName: recipient.sortName ?? null,
    organization: recipient.organization ?? null,
    role: recipient.role ?? null,
    relationship: recipient.relationship ?? null,
    defaultSalutation: recipient.defaultSalutation ?? null,
    defaultSignoff: recipient.defaultSignoff ?? null,
    defaultTone: recipient.defaultTone ?? null,
    notes: recipient.notes ?? null,
    preferences: recipient.preferences ?? {},
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!user.workspaceId) return notFound();

    if (isLocalFirstMode()) {
      const workflow = getLocalLetterWorkflow(id, user.id, user.workspaceId);
      return workflow ? NextResponse.json({ workflow }) : notFound();
    }

    const workflow = await db.query.letterWorkflows.findFirst({
      where: and(eq(letterWorkflows.id, id), eq(letterWorkflows.userId, user.id), eq(letterWorkflows.workspaceId, user.workspaceId)),
    });
    return workflow ? NextResponse.json({ workflow }) : notFound();
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!user.workspaceId) return notFound();
    const body = letterWorkflowUpdateSchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const existing = getLocalLetterWorkflow(id, user.id, user.workspaceId);
      if (!existing) return notFound();
      let snapshot = body.recipientSnapshot;
      if (body.recipientId && !snapshot) {
        const recipient = getLocalLetterRecipient(body.recipientId, user.id, user.workspaceId);
        if (!recipient) return notFound();
        snapshot = recipientSnapshot(recipient);
      }
      const workflow = updateLocalLetterWorkflow(id, user.id, user.workspaceId, {
        ...body,
        ...(snapshot !== undefined ? { recipientSnapshot: snapshot } : {}),
      });
      return workflow ? NextResponse.json({ workflow }) : notFound();
    }

    const existing = await db.query.letterWorkflows.findFirst({
      where: and(eq(letterWorkflows.id, id), eq(letterWorkflows.userId, user.id), eq(letterWorkflows.workspaceId, user.workspaceId)),
    });
    if (!existing) return notFound();
    let snapshot = body.recipientSnapshot;
    if (body.recipientId && !snapshot) {
      const recipient = await db.query.letterRecipients.findFirst({
        where: and(eq(letterRecipients.id, body.recipientId), eq(letterRecipients.userId, user.id), eq(letterRecipients.workspaceId, user.workspaceId)),
      });
      if (!recipient) return notFound();
      snapshot = recipientSnapshot(recipient);
    }

    const [workflow] = await db
      .update(letterWorkflows)
      .set({
        ...(body.pieceId !== undefined ? { pieceId: body.pieceId } : {}),
        ...(body.recipientId !== undefined ? { recipientId: body.recipientId } : {}),
        ...(snapshot !== undefined ? { recipientSnapshot: snapshot } : {}),
        ...(body.purpose !== undefined ? { purpose: body.purpose } : {}),
        ...(body.desiredOutcome !== undefined ? { desiredOutcome: body.desiredOutcome } : {}),
        ...(body.occasion !== undefined ? { occasion: body.occasion } : {}),
        ...(body.tone !== undefined ? { tone: body.tone } : {}),
        ...(body.constraints !== undefined ? { constraints: body.constraints } : {}),
        ...(body.sourceContext !== undefined ? { sourceContext: body.sourceContext } : {}),
        ...(body.uploads !== undefined ? { uploads: body.uploads } : {}),
        ...(body.dictationTranscript !== undefined ? { dictationTranscript: body.dictationTranscript } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(letterWorkflows.id, id), eq(letterWorkflows.userId, user.id), eq(letterWorkflows.workspaceId, user.workspaceId)))
      .returning();

    return workflow ? NextResponse.json({ workflow }) : notFound();
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!user.workspaceId) return notFound();

    if (isLocalFirstMode()) {
      const ok = deleteLocalLetterWorkflow(id, user.id, user.workspaceId);
      return ok ? NextResponse.json({ ok: true }) : notFound();
    }

    const [deleted] = await db
      .delete(letterWorkflows)
      .where(and(eq(letterWorkflows.id, id), eq(letterWorkflows.userId, user.id), eq(letterWorkflows.workspaceId, user.workspaceId)))
      .returning({ id: letterWorkflows.id });
    return deleted ? NextResponse.json({ ok: true }) : notFound();
  } catch (err) {
    return toErrorResponse(err);
  }
}
