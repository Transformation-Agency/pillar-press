import { NextResponse } from "next/server";
import { getCurrentUser, getOrCreateWorkspace, isAuthDisabled } from "@/lib/auth";
import { getOrCreateTrialSubscription } from "@/lib/billing/stripe";
import { isHostedWebMode, isLocalFirstMode } from "@/lib/local/mode";
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

    const subscription =
      workspaceId && isHostedWebMode() && !isAuthDisabled()
        ? await getOrCreateTrialSubscription({ ...user, workspaceId }, "auth_session")
        : null;

    return NextResponse.json({
      authenticated: true,
      authDisabled: isAuthDisabled(),
      user: {
        id: user.id,
        workspaceId,
        role: user.role ?? "author",
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
