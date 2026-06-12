import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/errors";
import { safeRecordAuditEvent } from "@/lib/audit";
import {
  appBaseUrl,
  BillingError,
  getLatestSubscription,
  getOrCreateBillingCustomer,
  getStripe,
  requireBillingUser,
  requireCheckoutPlan,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";

const CheckoutBody = z.object({
  planId: z.string().min(1).max(80),
});

const PORTAL_MANAGED_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

export async function POST(req: Request) {
  try {
    const user = await requireBillingUser();
    const body = CheckoutBody.parse(await req.json());
    const { plan, priceId } = await requireCheckoutPlan(body.planId);
    const currentSubscription = await getLatestSubscription(user.workspaceId);
    const hasPaidSubscription = Boolean(
      currentSubscription &&
      (currentSubscription.planId !== "trial" || currentSubscription.stripeSubscriptionId) &&
      PORTAL_MANAGED_STATUSES.has(currentSubscription.status),
    );

    if (hasPaidSubscription && currentSubscription?.planId === plan.id) {
      throw new BillingError(409, "plan_already_active", "You are already on this plan.");
    }

    if (hasPaidSubscription) {
      throw new BillingError(409, "billing_portal_required", "Manage billing to change your plan.");
    }

    const customer = await getOrCreateBillingCustomer({
      workspaceId: user.workspaceId,
      userId: user.id,
      email: user.email,
    });

    const baseUrl = appBaseUrl(req);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.stripeCustomerId,
      client_reference_id: user.workspaceId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl}/?billing=success&plan=${encodeURIComponent(plan.id)}`,
      cancel_url: `${baseUrl}/?billing=cancelled&plan=${encodeURIComponent(plan.id)}`,
      metadata: {
        workspaceId: user.workspaceId,
        userId: user.id,
        planId: plan.id,
        product: "kings_press",
      },
      subscription_data: {
        metadata: {
          workspaceId: user.workspaceId,
          userId: user.id,
          planId: plan.id,
          product: "kings_press",
        },
      },
    });

    await safeRecordAuditEvent({
      workspaceId: user.workspaceId,
      actorId: user.id,
      action: "billing.checkout_session.created",
      targetType: "checkout.session",
      targetId: session.id,
      metadata: {
        planId: plan.id,
        stripeCustomerId: customer.stripeCustomerId,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
