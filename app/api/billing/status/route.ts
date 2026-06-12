import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  getOrCreateTrialSubscription,
  listPublicPlans,
  requireBillingUser,
} from "@/lib/billing/stripe";
import {
  billingAccessForSubscription,
  billingLifecycleForSubscription,
  getEntitlementForPlan,
  safeRecordTrialEndingReminderEvent,
  safeRecordTrialExpirationEvent,
  usageSummaryForSubscription,
} from "@/lib/billing/usage";

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
    const access = billingAccessForSubscription(subscription);
    const lifecycle = billingLifecycleForSubscription(subscription, access);
    if (!access.allowed && access.code === "trial_expired") {
      await safeRecordTrialExpirationEvent({
        user,
        subscription,
        source: "billing_status",
      });
    } else if (lifecycle.trial.endsSoon) {
      await safeRecordTrialEndingReminderEvent({
        user,
        subscription,
        source: "billing_status",
        daysRemaining: lifecycle.trial.daysRemaining,
      });
    }

    return NextResponse.json({
      plans,
      subscription,
      entitlement,
      usage,
      access,
      lifecycle,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
