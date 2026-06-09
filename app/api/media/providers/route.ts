import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/errors";
import { getMediaProviderStatus } from "@/lib/mediaProviders";

// GET /api/media/providers
// Reports optional cloud media provider availability without exposing secrets.
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(getMediaProviderStatus());
  } catch (err) {
    return toErrorResponse(err);
  }
}
