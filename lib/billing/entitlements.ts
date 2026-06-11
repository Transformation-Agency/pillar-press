import { eq } from "drizzle-orm";
import {
  BillingError,
  getLatestSubscription,
  getOrCreateTrialSubscription,
  type BillingSessionUser,
} from "@/lib/billing/stripe";
import {
  billingAccessForSubscription,
} from "@/lib/billing/usage";
import { campaigns, db, entitlements } from "@/lib/db";

async function entitlementForPlan(planId: string) {
  const [entitlement] = await db
    .select()
    .from(entitlements)
    .where(eq(entitlements.planId, planId))
    .limit(1);
  return entitlement ?? null;
}

async function campaignCount(workspaceId: string) {
  const rows = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.workspaceId, workspaceId));
  return rows.length;
}

export async function requireCampaignCapacity(user: BillingSessionUser) {
  const subscription =
    (await getLatestSubscription(user.workspaceId)) ??
    (await getOrCreateTrialSubscription(user));
  const access = billingAccessForSubscription(subscription);
  if (!access.allowed) {
    throw new BillingError(402, access.code, access.message);
  }
  if (!subscription) {
    throw new BillingError(402, "subscription_required", "A subscription is required.");
  }

  const entitlement = await entitlementForPlan(subscription.planId);
  if (!entitlement) {
    throw new BillingError(403, "entitlement_missing", "Plan entitlement is missing.");
  }

  const current = await campaignCount(user.workspaceId);
  if (current >= entitlement.maxCampaigns) {
    throw new BillingError(
      402,
      "campaign_limit_exceeded",
      `Campaign limit reached for your plan (${entitlement.maxCampaigns}). Upgrade to create more campaigns.`,
    );
  }

  return {
    subscription,
    entitlement,
    current,
    limit: entitlement.maxCampaigns,
  };
}
