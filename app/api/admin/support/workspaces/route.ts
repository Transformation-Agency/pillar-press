import { NextResponse } from "next/server";
import { getSupportWorkspace, listSupportWorkspaces } from "@/lib/adminSupport";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim();
    const body = workspaceId
      ? await getSupportWorkspace(req, workspaceId)
      : await listSupportWorkspaces(req);
    return NextResponse.json(body);
  } catch (err) {
    return toErrorResponse(err);
  }
}
