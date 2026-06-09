import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gatherItems } from "@/db/gather-schema";
import {
  createLocalGatherItem,
  deleteLocalGatherItem,
  deleteLocalGatherItemsForCampaign,
  listLocalGatherItems,
} from "@/lib/local/database";
import { isLocalFirstMode } from "@/lib/local/mode";
import { createItemSchema } from "@/lib/gather-validation";
import { toErrorResponse } from "@/lib/errors";

// POST /api/gather/items  — create an item directly (uploaded documents).
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = createItemSchema.parse(await req.json());
    if (isLocalFirstMode()) {
      const item = createLocalGatherItem(body, user.id, user.workspaceId);
      if (!item) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
      return NextResponse.json({ item }, { status: 201 });
    }
    const [row] = await db.insert(gatherItems).values({
      ...(body.id ? { id: body.id } : {}),
      userId: user.id,
      campaignId: body.campaignId,
      kind: body.kind,
      title: body.title,
      source: body.source ?? null,
      author: body.author ?? null,
      url: body.url ?? null,
      snippet: body.snippet ?? null,
      transcript: body.transcript ?? null,
    }).returning();
    return NextResponse.json({ item: row }, { status: 201 });
  } catch (err) { return toErrorResponse(err); }
}

// GET /api/gather/items?campaignId=  — list the user's gathered items
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const campaignId = new URL(req.url).searchParams.get("campaignId");
    if (!campaignId) return NextResponse.json({ error: "Missing campaignId.", code: "bad_request" }, { status: 400 });
    if (isLocalFirstMode()) {
      const items = listLocalGatherItems(campaignId, user.id, user.workspaceId);
      if (!items) return NextResponse.json({ error: "Not found.", code: "not_found" }, { status: 404 });
      return NextResponse.json({ items });
    }
    const items = await db.select().from(gatherItems)
      .where(and(eq(gatherItems.userId, user.id), eq(gatherItems.campaignId, campaignId)))
      .orderBy(desc(gatherItems.createdAt)).limit(300);
    return NextResponse.json({ items });
  } catch (err) { return toErrorResponse(err); }
}

// DELETE /api/gather/items?id=   or   ?campaignId=  (clear all for campaign)
export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const u = new URL(req.url);
    const id = u.searchParams.get("id");
    const campaignId = u.searchParams.get("campaignId");
    if (isLocalFirstMode()) {
      if (id) deleteLocalGatherItem(id, user.id);
      else if (campaignId) deleteLocalGatherItemsForCampaign(campaignId, user.id);
      else return NextResponse.json({ error: "Missing id or campaignId.", code: "bad_request" }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (id) await db.delete(gatherItems).where(and(eq(gatherItems.id, id), eq(gatherItems.userId, user.id)));
    else if (campaignId) await db.delete(gatherItems).where(and(eq(gatherItems.campaignId, campaignId), eq(gatherItems.userId, user.id)));
    else return NextResponse.json({ error: "Missing id or campaignId.", code: "bad_request" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) { return toErrorResponse(err); }
}
