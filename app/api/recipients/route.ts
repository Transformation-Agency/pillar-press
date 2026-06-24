import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, letterRecipients } from "@/lib/db";
import { createLocalLetterRecipient, listLocalLetterRecipients } from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { recipientCreateSchema } from "@/lib/schemas-letters";
import { toErrorResponse } from "@/lib/errors";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user.workspaceId) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }

    if (isLocalFirstMode()) {
      return NextResponse.json({ recipients: listLocalLetterRecipients(user.id, user.workspaceId) });
    }

    const recipients = await db
      .select()
      .from(letterRecipients)
      .where(and(eq(letterRecipients.userId, user.id), eq(letterRecipients.workspaceId, user.workspaceId)))
      .orderBy(asc(letterRecipients.displayName));

    return NextResponse.json({ recipients });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.workspaceId) {
      return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
    }
    const body = recipientCreateSchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const recipient = createLocalLetterRecipient(body, user.id, user.workspaceId);
      return NextResponse.json({ recipient }, { status: 201 });
    }

    const [recipient] = await db
      .insert(letterRecipients)
      .values({
        ...(body.id ? { id: body.id } : {}),
        userId: user.id,
        workspaceId: user.workspaceId,
        displayName: body.displayName,
        sortName: body.sortName ?? null,
        organization: body.organization ?? null,
        role: body.role ?? null,
        relationship: body.relationship ?? null,
        defaultSalutation: body.defaultSalutation ?? null,
        defaultSignoff: body.defaultSignoff ?? null,
        defaultTone: body.defaultTone ?? null,
        notes: body.notes ?? null,
        preferences: body.preferences ?? {},
      })
      .returning();

    return NextResponse.json({ recipient }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
