import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { toErrorResponse } from "@/lib/errors";
import { integrationStatus } from "@/lib/gather/integrationKeys";

// GET /api/gather/integrations
// Reports which Gather connector keys are configured (desktop settings or env)
// without exposing secrets — mirrors /api/media/providers.
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ integrations: integrationStatus() });
  } catch (err) {
    return toErrorResponse(err);
  }
}
