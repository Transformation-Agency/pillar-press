import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/errors";
import {
  BillingError,
  appBaseUrl,
  getOrCreateBillingCustomer,
  getStripe,
  requireBillingUser,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";

const PortalBody = z.object({
  email: z.string().email().optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireBillingUser();
    const body = PortalBody.parse(await req.json().catch(() => ({})));
    const customer = await getOrCreateBillingCustomer({
      workspaceId: user.workspaceId,
      userId: user.id,
      email: body.email,
    });

    if (!customer.stripeCustomerId) {
      throw new BillingError(400, "billing_customer_missing", "Billing customer missing.");
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: `${appBaseUrl(req)}/?billing=portal-return`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
