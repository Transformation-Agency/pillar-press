import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  getOrCreateTrialSubscription,
  listPublicPlans,
  requireBillingUser,
} from "@/lib/billing/stripe";
import { getEntitlementForPlan, usageSummaryForSubscription } from "@/lib/billing/usage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireBillingUser();
    const [plans, subscription] = await Promise.all([
      listPublicPlans(),
      getOrCreateTrialSubscription(user),
    ]);
    const entitlement = subscription ? await getEntitlementForPlan(subscription.planId) : null;
    const usage = await usageSummaryForSubscription({
      workspaceId: user.workspaceId,
      subscription,
      entitlement,
    });

    return NextResponse.json({
      plans,
      subscription,
      entitlement,
      usage,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
