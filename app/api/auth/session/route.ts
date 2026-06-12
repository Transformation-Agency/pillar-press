import { NextResponse } from "next/server";
import { ensureWorkspaceForUser, getCurrentUser, isAuthDisabled } from "@/lib/auth";
import { getOrCreateTrialSubscription } from "@/lib/billing/stripe";
import { isHostedWebMode } from "@/lib/local/mode";
import { toErrorResponse } from "@/lib/errors";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ authenticated: false, user: null }, { status: 401 });
    }

    const userWithWorkspace = await ensureWorkspaceForUser(user);
    const workspaceId = userWithWorkspace.workspaceId;

    const subscription =
      workspaceId && isHostedWebMode() && !isAuthDisabled()
        ? await getOrCreateTrialSubscription(userWithWorkspace, "auth_session")
        : null;

    return NextResponse.json({
      authenticated: true,
      authDisabled: isAuthDisabled(),
      user: {
        id: user.id,
        workspaceId,
        role: userWithWorkspace.role ?? "author",
      },
      subscription: subscription
        ? {
          id: subscription.id,
          planId: subscription.planId,
          status: subscription.status,
          trialStart: subscription.trialStart,
          trialEnd: subscription.trialEnd,
          currentPeriodEnd: subscription.currentPeriodEnd,
        }
        : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
