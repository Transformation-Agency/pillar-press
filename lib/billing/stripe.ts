import Stripe from "stripe";
import { and, desc, eq } from "drizzle-orm";
import {
  auditEvents,
  billingCustomers,
  db,
  plans,
  subscriptions,
  trialEvents,
  type Plan,
  type SubscriptionStatus,
} from "@/lib/db";
import { getOrCreateWorkspace, requireUser, type SessionUser } from "@/lib/auth";

export class BillingError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BillingError";
    this.status = status;
    this.code = code;
  }
}

export type BillingSessionUser = SessionUser & { workspaceId: string };

export type PublicBillingPlan = {
  id: string;
  name: string;
  description: string | null;
  monthlyPriceCents: number;
  currency: string;
  trialDays: number;
  sortOrder: number;
  stripeConfigured: boolean;
};

const STATUS_VALUES = new Set<SubscriptionStatus>([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

let stripeClient: Stripe | null = null;

function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY?.trim() || "";
}

export function getStripe(): Stripe {
  const key = stripeSecretKey();
  if (!key) {
    throw new BillingError(
      503,
      "billing_not_configured",
      "Billing is not configured.",
    );
  }
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

export function stripePriceEnvName(planId: string) {
  const suffix = planId.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
  return `STRIPE_PRICE_${suffix}`;
}

export function resolvePlanStripePriceId(plan: Pick<Plan, "id" | "stripePriceId">) {
  return plan.stripePriceId?.trim() || process.env[stripePriceEnvName(plan.id)]?.trim() || null;
}

export function unixSecondsToDate(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

function planMeta(plan: Plan) {
  return (plan.meta ?? {}) as Record<string, unknown>;
}

function isPublicPlan(plan: Plan) {
  return plan.id !== "trial" && plan.active && planMeta(plan).public === true;
}

export function toPublicPlan(plan: Plan): PublicBillingPlan {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    monthlyPriceCents: plan.monthlyPriceCents,
    currency: plan.currency,
    trialDays: plan.trialDays,
    sortOrder: plan.sortOrder,
    stripeConfigured: Boolean(resolvePlanStripePriceId(plan)),
  };
}

export async function requireBillingUser(): Promise<BillingSessionUser> {
  const user = await requireUser();
  const workspaceId = user.workspaceId ?? (await getOrCreateWorkspace(user.id));
  return { ...user, workspaceId };
}

export async function listPublicPlans() {
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(plans.sortOrder);
  return rows.filter(isPublicPlan).map(toPublicPlan);
}

export async function findPlan(planId: string) {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.active, true)))
    .limit(1);
  return plan ?? null;
}

export async function requireCheckoutPlan(planId: string) {
  const plan = await findPlan(planId);
  if (!plan || !isPublicPlan(plan)) {
    throw new BillingError(400, "plan_unavailable", "This plan is unavailable.");
  }
  const priceId = resolvePlanStripePriceId(plan);
  if (!priceId) {
    throw new BillingError(
      503,
      "billing_not_configured",
      "Billing is not configured for this plan.",
    );
  }
  return { plan, priceId };
}

export async function getLatestSubscription(workspaceId: string) {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return subscription ?? null;
}

export async function getOrCreateTrialSubscription(user: BillingSessionUser) {
  const existing = await getLatestSubscription(user.workspaceId);
  if (existing) return existing;

  const [trialPlan] = await db
    .select()
    .from(plans)
    .where(eq(plans.id, "trial"))
    .limit(1);

  if (!trialPlan) return null;

  const now = new Date();
  const trialEnd = new Date(now.getTime() + Math.max(0, trialPlan.trialDays) * 24 * 60 * 60 * 1000);
  const [subscription] = await db
    .insert(subscriptions)
    .values({
      workspaceId: user.workspaceId,
      planId: trialPlan.id,
      status: "trialing",
      trialStart: now,
      trialEnd,
      metadata: { source: "hosted_signup_trial" },
    })
    .returning();

  await db.insert(trialEvents).values({
    workspaceId: user.workspaceId,
    userId: user.id,
    event: "started",
    planId: trialPlan.id,
    trialStart: now,
    trialEnd,
    metadata: { source: "billing_status" },
  });

  return subscription;
}

export async function getOrCreateBillingCustomer(input: {
  workspaceId: string;
  userId: string;
  email?: string | null;
}) {
  const [existing] = await db
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.workspaceId, input.workspaceId))
    .limit(1);
  if (existing) return existing;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: input.email ?? undefined,
    metadata: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      product: "kings_press",
    },
  });

  const [row] = await db
    .insert(billingCustomers)
    .values({
      workspaceId: input.workspaceId,
      stripeCustomerId: customer.id,
      billingEmail: input.email ?? null,
    })
    .returning();
  return row;
}

export function appBaseUrl(req: Request) {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured?.trim()) return configured.trim().replace(/\/+$/, "");
  return new URL(req.url).origin;
}

export function subscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  return STATUS_VALUES.has(status as SubscriptionStatus)
    ? (status as SubscriptionStatus)
    : "incomplete";
}

function stripeId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function firstSubscriptionItem(subscription: Stripe.Subscription) {
  return subscription.items.data[0] ?? null;
}

export function stripeSubscriptionSnapshot(subscription: Stripe.Subscription) {
  const item = firstSubscriptionItem(subscription);
  return {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: stripeId(subscription.customer),
    stripePriceId: item?.price?.id ?? null,
    status: subscriptionStatus(subscription.status),
    trialStart: unixSecondsToDate(subscription.trial_start),
    trialEnd: unixSecondsToDate(subscription.trial_end),
    currentPeriodStart: unixSecondsToDate(item?.current_period_start),
    currentPeriodEnd: unixSecondsToDate(item?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: unixSecondsToDate(subscription.canceled_at),
  };
}

async function planIdForStripePrice(priceId: string | null, metadataPlanId?: string | null) {
  if (metadataPlanId) {
    const plan = await findPlan(metadataPlanId);
    if (plan) return plan.id;
  }

  if (!priceId) return "trial";

  const rows = await db.select().from(plans).where(eq(plans.active, true));
  const plan = rows.find((row) => resolvePlanStripePriceId(row) === priceId);
  return plan?.id ?? "trial";
}

async function workspaceIdForStripeSubscription(subscription: Stripe.Subscription) {
  const metadataWorkspace = subscription.metadata?.workspaceId?.trim();
  if (metadataWorkspace) return metadataWorkspace;

  const customerId = stripeId(subscription.customer);
  if (!customerId) return null;

  const [customer] = await db
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.stripeCustomerId, customerId))
    .limit(1);
  return customer?.workspaceId ?? null;
}

export async function syncStripeSubscription(subscription: Stripe.Subscription) {
  const workspaceId = await workspaceIdForStripeSubscription(subscription);
  if (!workspaceId) {
    throw new BillingError(400, "workspace_not_found", "Workspace not found.");
  }

  const snapshot = stripeSubscriptionSnapshot(subscription);
  const planId = await planIdForStripePrice(snapshot.stripePriceId, subscription.metadata?.planId);
  const now = new Date();
  const values = {
    workspaceId,
    planId,
    stripeCustomerId: snapshot.stripeCustomerId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    stripePriceId: snapshot.stripePriceId,
    status: snapshot.status,
    trialStart: snapshot.trialStart,
    trialEnd: snapshot.trialEnd,
    currentPeriodStart: snapshot.currentPeriodStart,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    canceledAt: snapshot.canceledAt,
    metadata: {
      source: "stripe",
      stripeStatus: subscription.status,
    },
    updatedAt: now,
  };

  const [row] = await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: values,
    })
    .returning();

  return row;
}

function stripeObjectId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { id?: unknown };
  return typeof candidate.id === "string" ? candidate.id : null;
}

function stripeObjectType(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { object?: unknown };
  return typeof candidate.object === "string" ? candidate.object : null;
}

export function stripeAuditEventValues(input: {
  event: Pick<Stripe.Event, "id" | "type" | "created" | "livemode" | "account"> & {
    data: { object: unknown };
  };
  handled: boolean;
  workspaceId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return {
    workspaceId: input.workspaceId ?? null,
    actorType: "stripe" as const,
    actorId: input.event.account ?? "stripe",
    action: `stripe.${input.event.type}`,
    targetType: input.targetType ?? stripeObjectType(input.event.data.object),
    targetId: input.targetId ?? stripeObjectId(input.event.data.object),
    metadata: {
      eventId: input.event.id,
      eventType: input.event.type,
      handled: input.handled,
      livemode: input.event.livemode,
      created: input.event.created,
      ...(input.metadata ?? {}),
    },
  };
}

export function trialConversionEventValues(input: {
  workspaceId: string;
  userId?: string | null;
  planId: string;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  stripeSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  localSubscriptionId?: string | null;
}) {
  return {
    workspaceId: input.workspaceId,
    userId: input.userId ?? null,
    event: "converted",
    planId: input.planId,
    trialStart: input.trialStart ?? null,
    trialEnd: input.trialEnd ?? null,
    metadata: {
      source: "checkout.session.completed",
      stripeSessionId: input.stripeSessionId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      localSubscriptionId: input.localSubscriptionId ?? null,
    },
  };
}

async function trialEventExists(input: {
  workspaceId: string;
  event: string;
  planId: string;
}) {
  const [existing] = await db
    .select({ id: trialEvents.id })
    .from(trialEvents)
    .where(
      and(
        eq(trialEvents.workspaceId, input.workspaceId),
        eq(trialEvents.event, input.event),
        eq(trialEvents.planId, input.planId),
      ),
    )
    .limit(1);
  return Boolean(existing);
}

async function safeRecordTrialEventOnce(values: ReturnType<typeof trialConversionEventValues>) {
  try {
    if (await trialEventExists({
      workspaceId: values.workspaceId,
      event: values.event,
      planId: values.planId,
    })) {
      return;
    }
    await db.insert(trialEvents).values(values);
  } catch (err) {
    console.warn("trial_event_record_failed", err instanceof Error ? err.message : String(err));
  }
}

async function recordStripeAuditEvent(input: Parameters<typeof stripeAuditEventValues>[0]) {
  await db.insert(auditEvents).values(stripeAuditEventValues(input));
}

async function safeRecordStripeAuditEvent(input: Parameters<typeof stripeAuditEventValues>[0]) {
  try {
    await recordStripeAuditEvent(input);
  } catch (err) {
    console.warn("stripe_webhook_audit_failed", err instanceof Error ? err.message : String(err));
  }
}

export async function handleStripeWebhookEvent(event: Stripe.Event) {
  const stripe = getStripe();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const subscriptionId = stripeId(session.subscription as string | { id: string } | null);
    let synced: Awaited<ReturnType<typeof syncStripeSubscription>> | null = null;
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      synced = await syncStripeSubscription(subscription);
    }
    if (synced && synced.planId !== "trial") {
      await safeRecordTrialEventOnce(trialConversionEventValues({
        workspaceId: synced.workspaceId,
        userId: typeof session.metadata?.userId === "string" ? session.metadata.userId : null,
        planId: synced.planId,
        trialStart: synced.trialStart,
        trialEnd: synced.trialEnd,
        stripeSessionId: session.id,
        stripeSubscriptionId: subscriptionId,
        localSubscriptionId: synced.id,
      }));
    }
    await safeRecordStripeAuditEvent({
      event,
      handled: true,
      workspaceId: synced?.workspaceId ?? null,
      targetType: "checkout.session",
      targetId: session.id,
      metadata: {
        stripeSubscriptionId: subscriptionId,
        localSubscriptionId: synced?.id,
      },
    });
    return { handled: true };
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const synced = await syncStripeSubscription(event.data.object as Stripe.Subscription);
    await safeRecordStripeAuditEvent({
      event,
      handled: true,
      workspaceId: synced.workspaceId,
      targetType: "subscription",
      targetId: synced.id,
      metadata: {
        stripeSubscriptionId: synced.stripeSubscriptionId,
        status: synced.status,
      },
    });
    return { handled: true };
  }

  await safeRecordStripeAuditEvent({ event, handled: false });
  return { handled: false };
}
