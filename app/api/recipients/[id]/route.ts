import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, letterRecipients } from "@/lib/db";
import { deleteLocalLetterRecipient, getLocalLetterRecipient, updateLocalLetterRecipient } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { recipientUpdateSchema } from "@/lib/schemas-letters";
import { toErrorResponse } from "@/lib/errors";

const notFound = () => NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!user.workspaceId) return notFound();

    if (isLocalFirstMode()) {
      const recipient = getLocalLetterRecipient(id, user.id, user.workspaceId);
      return recipient ? NextResponse.json({ recipient }) : notFound();
    }

    const recipient = await db.query.letterRecipients.findFirst({
      where: and(eq(letterRecipients.id, id), eq(letterRecipients.userId, user.id), eq(letterRecipients.workspaceId, user.workspaceId)),
    });
    return recipient ? NextResponse.json({ recipient }) : notFound();
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!user.workspaceId) return notFound();
    const body = recipientUpdateSchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const recipient = updateLocalLetterRecipient(id, user.id, user.workspaceId, body);
      return recipient ? NextResponse.json({ recipient }) : notFound();
    }

    const [recipient] = await db
      .update(letterRecipients)
      .set({
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.sortName !== undefined ? { sortName: body.sortName } : {}),
        ...(body.organization !== undefined ? { organization: body.organization } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.relationship !== undefined ? { relationship: body.relationship } : {}),
        ...(body.defaultSalutation !== undefined ? { defaultSalutation: body.defaultSalutation } : {}),
        ...(body.defaultSignoff !== undefined ? { defaultSignoff: body.defaultSignoff } : {}),
        ...(body.defaultTone !== undefined ? { defaultTone: body.defaultTone } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.preferences !== undefined ? { preferences: body.preferences } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(letterRecipients.id, id), eq(letterRecipients.userId, user.id), eq(letterRecipients.workspaceId, user.workspaceId)))
      .returning();

    return recipient ? NextResponse.json({ recipient }) : notFound();
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
      const ok = deleteLocalLetterRecipient(id, user.id, user.workspaceId);
      return ok ? NextResponse.json({ ok: true }) : notFound();
    }

    const [deleted] = await db
      .delete(letterRecipients)
      .where(and(eq(letterRecipients.id, id), eq(letterRecipients.userId, user.id), eq(letterRecipients.workspaceId, user.workspaceId)))
      .returning({ id: letterRecipients.id });
    return deleted ? NextResponse.json({ ok: true }) : notFound();
  } catch (err) {
    return toErrorResponse(err);
  }
}
