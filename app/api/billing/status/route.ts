import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { isLocalFirstMode } from "@/lib/local/mode";
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
    if (isLocalFirstMode()) {
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const subscription = {
        id: "local-desktop",
        workspaceId: "local-workspace",
        planId: "local-desktop",
        status: "active",
      };
      const entitlement = {
        planId: "local-desktop",
        monthlyLlmCredits: 0,
        monthlyGatherRuns: 0,
        monthlyMediaGenerations: 0,
        storageQuotaGb: 0,
        canUseManagedKeys: false,
        allowedProviders: ["byok", "local"],
      };
      const usage = {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        dimensions: {
          llm: { used: 0, limit: 0, remaining: 0 },
          gather: { used: 0, limit: 0, remaining: 0 },
          media: { used: 0, limit: 0, remaining: 0 },
          storage: { used: 0, limit: 0, remaining: 0 },
        },
      };
      return NextResponse.json({
        plans: [{
          id: "local-desktop",
          name: "Local Desktop",
          description: "Local-first desktop mode does not require hosted Stripe billing.",
          monthlyPriceCents: 0,
          currency: "usd",
          trialDays: 0,
          sortOrder: 0,
          stripeConfigured: false,
        }],
        subscription,
        entitlement,
        usage,
        access: { allowed: true },
        lifecycle: {
          planId: "local-desktop",
          status: "active",
          accessCode: null,
          primaryAction: "none",
          upgradeRecommended: false,
          trial: {
            startedAt: null,
            endsAt: null,
            daysRemaining: null,
            expired: false,
            endsSoon: false,
          },
        },
      });
    }

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
