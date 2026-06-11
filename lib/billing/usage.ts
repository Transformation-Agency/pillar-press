import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { getOrCreateWorkspace, type SessionUser } from "@/lib/auth";
import {
  db,
  entitlements,
  usageEvents,
  type Entitlement,
  type Subscription,
  type UsageEventTask,
} from "@/lib/db";
import { isLocalFirstMode } from "@/lib/local/mode";
import {
  BillingError,
  getLatestSubscription,
  getOrCreateTrialSubscription,
  type BillingSessionUser,
} from "@/lib/billing/stripe";

type UsageDimension = "llm" | "media" | "gather";
const USAGE_DIMENSIONS: UsageDimension[] = ["llm", "media", "gather"];

export type UsageReservationInput = {
  user: SessionUser;
  task: UsageEventTask;
  feature: string;
  idempotencyKey?: string;
  campaignId?: string | null;
  pieceId?: string | null;
  provider?: string | null;
  model?: string | null;
  estimatedCredits?: number;
  metadata?: Record<string, unknown>;
};

export type UsageReservation = {
  id: string;
  workspaceId: string;
  idempotencyKey: string;
} | null;

export type BillingAccess =
  | { allowed: true }
  | { allowed: false; code: "subscription_required" | "subscription_inactive" | "trial_expired"; message: string };

function startOfUtcMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function startOfNextUtcMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function periodForSubscription(subscription: Subscription | null, now = new Date()) {
  const start = subscription?.currentPeriodStart ?? subscription?.trialStart ?? startOfUtcMonth(now);
  const end = subscription?.currentPeriodEnd ?? subscription?.trialEnd ?? startOfNextUtcMonth(now);
  return { start, end };
}

export function usageDimensionForTask(task: UsageEventTask): UsageDimension {
  if (task === "media_generation") return "media";
  if (task === "gather") return "gather";
  return "llm";
}

function limitForDimension(
  entitlement: Entitlement,
  dimension: UsageDimension,
) {
  if (dimension === "media") return entitlement.monthlyMediaGenerations;
  if (dimension === "gather") return entitlement.monthlyGatherRuns;
  return entitlement.monthlyLlmCredits;
}

function tasksForDimension(dimension: UsageDimension): UsageEventTask[] {
  if (dimension === "media") return ["media_generation"];
  if (dimension === "gather") return ["gather"];
  return [
    "review",
    "revision",
    "outputs",
    "weave",
    "file_extract",
    "chat",
    "utility",
  ];
}

function estimateCredits(input: UsageReservationInput) {
  return Math.max(1, Math.ceil(input.estimatedCredits ?? 1));
}

async function billingUserFromSession(user: SessionUser): Promise<BillingSessionUser> {
  const workspaceId = user.workspaceId ?? (await getOrCreateWorkspace(user.id));
  return { ...user, workspaceId };
}

async function activeSubscriptionForWorkspace(user: BillingSessionUser) {
  return (await getLatestSubscription(user.workspaceId)) ?? (await getOrCreateTrialSubscription(user));
}

async function entitlementForPlan(planId: string) {
  const [entitlement] = await db
    .select()
    .from(entitlements)
    .where(eq(entitlements.planId, planId))
    .limit(1);
  return entitlement ?? null;
}

export async function getEntitlementForPlan(planId: string) {
  return entitlementForPlan(planId);
}

async function usedCredits(input: {
  workspaceId: string;
  dimension: UsageDimension;
  periodStart: Date;
  periodEnd: Date;
}) {
  const rows = await db
    .select({
      status: usageEvents.status,
      estimatedCredits: usageEvents.estimatedCredits,
      actualCredits: usageEvents.actualCredits,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.workspaceId, input.workspaceId),
        inArray(usageEvents.task, tasksForDimension(input.dimension)),
        inArray(usageEvents.status, ["reserved", "succeeded"]),
        gte(usageEvents.createdAt, input.periodStart),
        lt(usageEvents.createdAt, input.periodEnd),
      ),
    );

  return rows.reduce((sum, row) => {
    const actual = row.status === "succeeded" ? row.actualCredits : 0;
    return sum + Math.max(actual || row.estimatedCredits || 0, 0);
  }, 0);
}

export function quotaErrorMessage(dimension: UsageDimension) {
  if (dimension === "media") return "Media generation limit reached for this billing period.";
  if (dimension === "gather") return "Gather run limit reached for this billing period.";
  return "AI usage limit reached for this billing period.";
}

export function subscriptionAllowsUsage(status: Subscription["status"] | string | null | undefined) {
  return status === "trialing" || status === "active";
}

export function billingAccessForSubscription(
  subscription: Pick<Subscription, "status" | "trialEnd"> | null | undefined,
  now = new Date(),
): BillingAccess {
  if (!subscription) {
    return { allowed: false, code: "subscription_required", message: "A subscription is required." };
  }
  if (
    subscription.status === "trialing" &&
    subscription.trialEnd &&
    subscription.trialEnd.getTime() <= now.getTime()
  ) {
    return {
      allowed: false,
      code: "trial_expired",
      message: "Your free trial has ended. Choose a plan to continue.",
    };
  }
  if (!subscriptionAllowsUsage(subscription.status)) {
    return {
      allowed: false,
      code: "subscription_inactive",
      message: "Your subscription is not active. Manage billing or choose a plan to continue.",
    };
  }
  return { allowed: true };
}

export async function usageSummaryForSubscription(input: {
  workspaceId: string;
  subscription: Subscription | null;
  entitlement: Entitlement | null;
}) {
  const period = periodForSubscription(input.subscription);
  const rows = await Promise.all(
    USAGE_DIMENSIONS.map(async (dimension) => {
      const used = await usedCredits({
        workspaceId: input.workspaceId,
        dimension,
        periodStart: period.start,
        periodEnd: period.end,
      });
      const limit = input.entitlement ? limitForDimension(input.entitlement, dimension) : 0;
      return [dimension, {
        used,
        limit,
        remaining: Math.max(limit - used, 0),
      }] as const;
    }),
  );
  return {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    dimensions: Object.fromEntries(rows),
  };
}

export async function reserveUsage(input: UsageReservationInput): Promise<UsageReservation> {
  if (isLocalFirstMode()) return null;

  const user = await billingUserFromSession(input.user);
  const subscription = await activeSubscriptionForWorkspace(user);
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

  const dimension = usageDimensionForTask(input.task);
  const limit = limitForDimension(entitlement, dimension);
  const credits = estimateCredits(input);
  const period = periodForSubscription(subscription);
  const used = await usedCredits({
    workspaceId: user.workspaceId,
    dimension,
    periodStart: period.start,
    periodEnd: period.end,
  });

  if (used + credits > limit) {
    throw new BillingError(402, "quota_exceeded", quotaErrorMessage(dimension));
  }

  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const [reservation] = await db
    .insert(usageEvents)
    .values({
      workspaceId: user.workspaceId,
      userId: user.id,
      campaignId: input.campaignId ?? null,
      pieceId: input.pieceId ?? null,
      idempotencyKey,
      task: input.task,
      feature: input.feature,
      provider: input.provider ?? null,
      model: input.model ?? null,
      status: "reserved",
      estimatedCredits: credits,
      metadata: input.metadata ?? {},
    })
    .onConflictDoNothing({
      target: [usageEvents.workspaceId, usageEvents.idempotencyKey],
    })
    .returning({ id: usageEvents.id });

  if (reservation) {
    return {
      id: reservation.id,
      workspaceId: user.workspaceId,
      idempotencyKey,
    };
  }

  const [existing] = await db
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(and(eq(usageEvents.workspaceId, user.workspaceId), eq(usageEvents.idempotencyKey, idempotencyKey)))
    .limit(1);

  return existing ? { id: existing.id, workspaceId: user.workspaceId, idempotencyKey } : null;
}

export async function completeUsageReservation(
  reservation: UsageReservation,
  input: {
    actualCredits?: number;
    inputTokens?: number | null;
    outputTokens?: number | null;
    providerRequestId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  if (!reservation) return;
  await db
    .update(usageEvents)
    .set({
      status: "succeeded",
      actualCredits: Math.max(1, Math.ceil(input.actualCredits ?? 1)),
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      providerRequestId: input.providerRequestId ?? null,
      metadata: input.metadata ?? {},
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(usageEvents.id, reservation.id));
}

export async function failUsageReservation(reservation: UsageReservation, err: unknown) {
  if (!reservation) return;
  const code = (err as { code?: unknown })?.code;
  const message = (err as Error)?.message ?? "Unknown error";
  await db
    .update(usageEvents)
    .set({
      status: "failed",
      errorCode: typeof code === "string" ? code.slice(0, 120) : "error",
      errorMessage: message.slice(0, 500),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(usageEvents.id, reservation.id));
}
