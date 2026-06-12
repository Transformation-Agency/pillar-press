import { NextResponse } from "next/server";
import { z } from "zod";
import { extendSupportTrial } from "@/lib/adminSupport";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

const bodySchema = z.object({
  workspaceId: z.string().trim().min(1).max(120),
  days: z.number().int().min(1).max(90),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const result = await extendSupportTrial({
      req,
      workspaceId: body.workspaceId,
      days: body.days,
      reason: body.reason,
    });
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
