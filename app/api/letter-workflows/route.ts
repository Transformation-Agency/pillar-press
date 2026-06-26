import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db, campaigns, letterRecipients, letterWorkflows } from "@/lib/db";
import {
  createLocalLetterWorkflow,
  getLocalCampaign,
  getLocalLetterRecipient,
  listLocalLetterWorkflows,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { letterWorkflowCreateSchema } from "@/lib/schemas-letters";
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

async function resolveHostedCampaign(campaignId: string, workspaceId: string | undefined) {
  if (!workspaceId) return null;
  return db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)),
  });
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (!user.workspaceId) return notFound();
    const campaignId = new URL(req.url).searchParams.get("campaignId") || "";
    if (!campaignId) {
      return NextResponse.json({ error: "campaignId is required.", code: "bad_request" }, { status: 400 });
    }

    if (isLocalFirstMode()) {
      const workflows = listLocalLetterWorkflows(campaignId, user.id, user.workspaceId);
      return workflows ? NextResponse.json({ workflows }) : notFound();
    }

    const campaign = await resolveHostedCampaign(campaignId, user.workspaceId);
    if (!campaign) return notFound();
    const workflows = await db
      .select()
      .from(letterWorkflows)
      .where(and(
        eq(letterWorkflows.campaignId, campaign.id),
        eq(letterWorkflows.userId, user.id),
        eq(letterWorkflows.workspaceId, user.workspaceId),
      ))
      .orderBy(desc(letterWorkflows.updatedAt));

    return NextResponse.json({ workflows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!user.workspaceId) return notFound();
    const body = letterWorkflowCreateSchema.parse(await req.json());

    if (isLocalFirstMode()) {
      const campaign = getLocalCampaign(body.campaignId, user.workspaceId);
      if (!campaign) return notFound();
      const recipient = body.recipientId
        ? getLocalLetterRecipient(body.recipientId, user.id, user.workspaceId)
        : null;
      if (body.recipientId && !recipient) return notFound();
      const snapshot = Object.keys(body.recipientSnapshot || {}).length
        ? body.recipientSnapshot
        : recipientSnapshot(recipient);
      const workflow = createLocalLetterWorkflow(
        { ...body, recipientSnapshot: snapshot },
        user.id,
        user.workspaceId,
      );
      return workflow ? NextResponse.json({ workflow }, { status: 201 }) : notFound();
    }

    const campaign = await resolveHostedCampaign(body.campaignId, user.workspaceId);
    if (!campaign) return notFound();
    const recipient = body.recipientId
      ? await db.query.letterRecipients.findFirst({
        where: and(
          eq(letterRecipients.id, body.recipientId),
          eq(letterRecipients.userId, user.id),
          eq(letterRecipients.workspaceId, user.workspaceId),
        ),
      })
      : null;
    if (body.recipientId && !recipient) return notFound();
    const snapshot = Object.keys(body.recipientSnapshot || {}).length
      ? body.recipientSnapshot
      : recipientSnapshot(recipient);

    const [workflow] = await db
      .insert(letterWorkflows)
      .values({
        ...(body.id ? { id: body.id } : {}),
        userId: user.id,
        workspaceId: user.workspaceId,
        campaignId: campaign.id,
        pieceId: body.pieceId ?? null,
        recipientId: body.recipientId ?? null,
        recipientSnapshot: snapshot,
        purpose: body.purpose ?? "",
        desiredOutcome: body.desiredOutcome ?? null,
        occasion: body.occasion ?? null,
        tone: body.tone ?? null,
        constraints: body.constraints ?? null,
        sourceContext: body.sourceContext ?? null,
        uploads: body.uploads ?? [],
        dictationTranscript: body.dictationTranscript ?? null,
        status: body.status ?? "draft",
      })
      .returning();

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
