import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { gatherSources } from "@/db/gather-schema";
import { createSourceSchema } from "@/lib/gather-validation";
import { toErrorResponse } from "@/lib/errors";

// GET /api/gather/sources?campaignId=  — list (user + campaign scoped)
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const campaignId = new URL(req.url).searchParams.get("campaignId");
    if (!campaignId) return NextResponse.json({ error: "Missing campaignId.", code: "bad_request" }, { status: 400 });
    const rows = await db.select().from(gatherSources)
      .where(and(eq(gatherSources.userId, user.id), eq(gatherSources.campaignId, campaignId)));
    return NextResponse.json({ sources: rows });
  } catch (err) { return toErrorResponse(err); }
}

// POST /api/gather/sources  — create
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = createSourceSchema.parse(await req.json());
    const [row] = await db.insert(gatherSources).values({ ...body, userId: user.id }).returning();
    return NextResponse.json({ source: row }, { status: 201 });
  } catch (err) { return toErrorResponse(err); }
}
