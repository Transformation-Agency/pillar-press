import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  BillingError,
  getStripe,
  handleStripeWebhookEvent,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      throw new BillingError(
        503,
        "billing_webhook_not_configured",
        "Billing webhook is not configured.",
      );
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      throw new BillingError(400, "missing_signature", "Missing webhook signature.");
    }

    const payload = await req.text();
    const event = getStripe().webhooks.constructEvent(payload, signature, secret);
    const result = await handleStripeWebhookEvent(event);

    return NextResponse.json({ received: true, handled: result.handled });
  } catch (err) {
    return toErrorResponse(err);
  }
}
