import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/errors";
import {
  appBaseUrl,
  getOrCreateBillingCustomer,
  getStripe,
  requireBillingUser,
  requireCheckoutPlan,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";

const CheckoutBody = z.object({
  planId: z.string().min(1).max(80),
  email: z.string().email().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireBillingUser();
    const body = CheckoutBody.parse(await req.json());
    const { plan, priceId } = await requireCheckoutPlan(body.planId);
    const customer = await getOrCreateBillingCustomer({
      workspaceId: user.workspaceId,
      userId: user.id,
      email: body.email,
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

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
