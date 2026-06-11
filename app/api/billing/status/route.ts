import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  getOrCreateTrialSubscription,
  listPublicPlans,
  requireBillingUser,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireBillingUser();
    const [plans, subscription] = await Promise.all([
      listPublicPlans(),
      getOrCreateTrialSubscription(user),
    ]);

    return NextResponse.json({
      plans,
      subscription,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
