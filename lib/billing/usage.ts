import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getOrCreateWorkspace, type SessionUser } from "@/lib/auth";
import {
  db,
  entitlements,
  usageEvents,
  usageRollups,
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
  providerSource?: "managed" | "byok";
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

export type StorageReservation = {
  workspaceId: string;
  bytes: number;
  periodStart: Date;
  periodEnd: Date;
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

const GIB = 1024n * 1024n * 1024n;

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

export function storageQuotaBytes(entitlement: Pick<Entitlement, "storageQuotaGb">) {
  return BigInt(Math.max(0, entitlement.storageQuotaGb)) * GIB;
}

export function entitlementAllowsManagedProvider(entitlement: Pick<Entitlement, "allowedProviders" | "canUseManagedKeys">) {
  const allowed = Array.isArray(entitlement.allowedProviders) ? entitlement.allowedProviders : [];
  return entitlement.canUseManagedKeys && allowed.includes("managed");
}

export function entitlementAllowsByokProvider(entitlement: Pick<Entitlement, "allowedProviders">) {
  const allowed = Array.isArray(entitlement.allowedProviders) ? entitlement.allowedProviders : [];
  return allowed.includes("byok");
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

function normalizeStorageBytes(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.max(0, Math.trunc(value)));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
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

async function usedStorageBytes(input: {
  workspaceId: string;
  periodStart: Date;
  periodEnd: Date;
}) {
  const [rollup] = await db
    .select({ storageBytesUsed: usageRollups.storageBytesUsed })
    .from(usageRollups)
    .where(
      and(
        eq(usageRollups.workspaceId, input.workspaceId),
        eq(usageRollups.periodStart, input.periodStart),
        eq(usageRollups.periodEnd, input.periodEnd),
      ),
    )
    .limit(1);
  return normalizeStorageBytes(rollup?.storageBytesUsed);
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
  const storageUsed = await usedStorageBytes({
    workspaceId: input.workspaceId,
    periodStart: period.start,
    periodEnd: period.end,
  });
  const storageLimit = input.entitlement ? storageQuotaBytes(input.entitlement) : 0n;
  return {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    dimensions: {
      ...Object.fromEntries(rows),
      storage: {
        used: Number(storageUsed),
        limit: Number(storageLimit),
        remaining: Number(storageLimit > storageUsed ? storageLimit - storageUsed : 0n),
      },
    },
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
  const providerSource = input.providerSource ?? "managed";
  if (providerSource === "byok" && !entitlementAllowsByokProvider(entitlement)) {
    throw new BillingError(
      402,
      "byok_provider_not_enabled",
      "Bring-your-own-key provider usage is not included in your current plan.",
    );
  }
  if (providerSource === "managed" && !entitlementAllowsManagedProvider(entitlement)) {
    throw new BillingError(
      402,
      "managed_provider_not_enabled",
      "Managed AI provider usage is not included in your current plan. Upgrade or connect your own provider to continue.",
    );
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
      metadata: { ...(input.metadata ?? {}), providerSource },
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

export async function reserveStorageBytes(input: {
  user: SessionUser;
  bytes: number;
  feature: string;
}): Promise<StorageReservation> {
  if (isLocalFirstMode()) return null;

  const bytes = Math.max(0, Math.ceil(input.bytes));
  if (!bytes) return null;

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

  const period = periodForSubscription(subscription);
  const [rollup] = await db
    .select({ storageBytesUsed: usageRollups.storageBytesUsed })
    .from(usageRollups)
    .where(
      and(
        eq(usageRollups.workspaceId, user.workspaceId),
        eq(usageRollups.periodStart, period.start),
        eq(usageRollups.periodEnd, period.end),
      ),
    )
    .limit(1);

  const used = normalizeStorageBytes(rollup?.storageBytesUsed);
  const requested = BigInt(bytes);
  const limit = storageQuotaBytes(entitlement);
  if (used + requested > limit) {
    throw new BillingError(
      402,
      "storage_quota_exceeded",
      "Storage quota reached for your plan. Upgrade or remove files to add more.",
    );
  }

  await db
    .insert(usageRollups)
    .values({
      workspaceId: user.workspaceId,
      periodStart: period.start,
      periodEnd: period.end,
      storageBytesUsed: requested.toString(),
    })
    .onConflictDoUpdate({
      target: [usageRollups.workspaceId, usageRollups.periodStart, usageRollups.periodEnd],
      set: {
        storageBytesUsed: sql`${usageRollups.storageBytesUsed} + ${requested.toString()}`,
        updatedAt: new Date(),
      },
    });

  return {
    workspaceId: user.workspaceId,
    bytes,
    periodStart: period.start,
    periodEnd: period.end,
  };
}

export async function releaseStorageReservation(reservation: StorageReservation) {
  if (!reservation) return;
  await db
    .update(usageRollups)
    .set({
      storageBytesUsed: sql`GREATEST(${usageRollups.storageBytesUsed} - ${reservation.bytes.toString()}, 0)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(usageRollups.workspaceId, reservation.workspaceId),
        eq(usageRollups.periodStart, reservation.periodStart),
        eq(usageRollups.periodEnd, reservation.periodEnd),
      ),
    );
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
