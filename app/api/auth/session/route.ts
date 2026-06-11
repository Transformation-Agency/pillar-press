import { NextResponse } from "next/server";
import { getCurrentUser, getOrCreateWorkspace, isAuthDisabled } from "@/lib/auth";
import { isLocalFirstMode } from "@/lib/local/mode";
import { toErrorResponse } from "@/lib/errors";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ authenticated: false, user: null }, { status: 401 });
    }

    let workspaceId = user.workspaceId;
    if (!workspaceId && !isLocalFirstMode()) {
      workspaceId = await getOrCreateWorkspace(user.id);
    }

    return NextResponse.json({
      authenticated: true,
      authDisabled: isAuthDisabled(),
      user: {
        id: user.id,
        workspaceId,
        role: user.role ?? "author",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
