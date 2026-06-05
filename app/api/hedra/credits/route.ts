import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getCredits } from "@/lib/hedra";
import { toErrorResponse } from "@/lib/errors";

// GET /api/hedra/credits
export async function GET() {
  try {
    await requireUser();
    const credits = await getCredits();
    return NextResponse.json(credits);
  } catch (err) {
    return toErrorResponse(err);
  }
}
