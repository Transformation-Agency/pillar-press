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

export async function POST(req: Request) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({}));
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    const credits = await getCredits({ apiKey });
    return NextResponse.json({ ok: true, configured: true, credits });
  } catch (err) {
    return toErrorResponse(err);
  }
}
