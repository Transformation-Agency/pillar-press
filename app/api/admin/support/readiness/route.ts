import { NextResponse } from "next/server";
import { getHostedReadiness } from "@/lib/adminSupport";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    return NextResponse.json(await getHostedReadiness(req));
  } catch (err) {
    return toErrorResponse(err);
  }
}
