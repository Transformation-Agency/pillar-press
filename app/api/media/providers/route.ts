import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/errors";
import { getMediaProviderStatusForUser } from "@/lib/mediaProviders";

// GET /api/media/providers
// Reports optional cloud media provider availability without exposing secrets.
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await getMediaProviderStatusForUser(user));
  } catch (err) {
    return toErrorResponse(err);
  }
}
