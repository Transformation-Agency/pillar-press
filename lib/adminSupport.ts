import { eq, sql } from "drizzle-orm";
import { safeRecordAuditEvent } from "@/lib/audit";
import { isAuthDisabled } from "@/lib/auth";
import { BillingError, getLatestSubscription } from "@/lib/billing/stripe";
import { db, subscriptions, trialEvents } from "@/lib/db";
import { isHostedWebMode, isLocalFirstMode } from "@/lib/local/mode";

type QueryResult = { rows?: unknown[] } | unknown[];

function rowsOf<T = Record<string, unknown>>(result: QueryResult): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function adminSecret() {
  return process.env.PILLAR_PRESS_ADMIN_SECRET?.trim() || "";
}

function supportSecret() {
  return process.env.PILLAR_PRESS_SUPPORT_SECRET?.trim() || "";
}

function presentedSecrets(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^bearer\s+/i, "").trim();
  const header = req.headers.get("x-pillar-press-admin-secret")?.trim();
  return [bearer, header].filter((value): value is string => Boolean(value));
}

function hasPresentedSecret(tokens: string[], secret: string) {
  return Boolean(secret) && tokens.includes(secret);
}

export function requireAdminSupportAccess(req: Request) {
  const admin = adminSecret();
  const support = supportSecret();
  if (!admin && !support) {
    throw new BillingError(503, "admin_not_configured", "Admin support tools are not configured.");
  }
  const tokens = presentedSecrets(req);
  if (!hasPresentedSecret(tokens, admin) && !hasPresentedSecret(tokens, support)) {
    throw new BillingError(401, "unauthorized", "Unauthorized.");
  }
}

export function requireAdminMutationAccess(req: Request) {
  const admin = adminSecret();
  if (!admin) {
    throw new BillingError(503, "admin_not_configured", "Admin mutation tools are not configured.");
  }
  const tokens = presentedSecrets(req);
  if (hasPresentedSecret(tokens, admin)) return;
  const support = supportSecret();
  if (hasPresentedSecret(tokens, support)) {
    throw new BillingError(403, "admin_required", "Admin access is required.");
  }
  throw new BillingError(401, "unauthorized", "Unauthorized.");
}

type ReadinessSeverity = "required" | "recommended" | "optional";

type ReadinessCheck = {
  id: string;
  label: string;
  severity: ReadinessSeverity;
  ok: boolean;
  missing: string[];
  notes?: string[];
};

function envValue(name: string) {
  return process.env[name]?.trim() || "";
}

function present(names: string[]) {
  return names.filter((name) => Boolean(envValue(name)));
}

function missing(names: string[]) {
  return names.filter((name) => !envValue(name));
}

function checkAll(input: {
  id: string;
  label: string;
  severity: ReadinessSeverity;
  names: string[];
  notes?: string[];
}): ReadinessCheck {
  const miss = missing(input.names);
  return {
    id: input.id,
    label: input.label,
    severity: input.severity,
    ok: miss.length === 0,
    missing: miss,
    ...(input.notes?.length ? { notes: input.notes } : {}),
  };
}

function hostedFlagCheck(): ReadinessCheck {
  const hosted = isHostedWebMode();
  const localFirst = isLocalFirstMode();
  const notes: string[] = [];
  if (!hosted) notes.push("Hosted mode is not active.");
  if (localFirst) notes.push("Local-first mode is still active.");
  return {
    id: "runtime",
    label: "Hosted runtime flags",
    severity: "required",
    ok: hosted && !localFirst,
    missing: [
      ...(!hosted ? ["PILLAR_PRESS_RUNTIME=hosted or PILLAR_PRESS_HOSTED_WEB=true"] : []),
      ...(localFirst ? ["PILLAR_PRESS_LOCAL_FIRST=false"] : []),
    ],
    ...(notes.length ? { notes } : {}),
  };
}

function authModeCheck(): ReadinessCheck {
  const authDisabled = isAuthDisabled();
  return {
    id: "auth-mode",
    label: "Hosted account auth",
    severity: "required",
    ok: !authDisabled,
    missing: authDisabled ? ["AUTH_DISABLED=false"] : [],
    notes: authDisabled ? ["Hosted SaaS should use Supabase Auth, not shared disabled-auth sessions."] : undefined,
  };
}

function supportSecretCheck(): ReadinessCheck {
  const hasAdmin = Boolean(adminSecret());
  const hasSupport = Boolean(supportSecret());
  const notes = hasSupport ? [] : ["PILLAR_PRESS_SUPPORT_SECRET is optional read-only support access; admin access is configured separately."];
  return {
    id: "support-secrets",
    label: "Support/admin secrets",
    severity: "required",
    ok: hasAdmin,
    missing: hasAdmin ? [] : ["PILLAR_PRESS_ADMIN_SECRET"],
    ...(notes.length ? { notes } : {}),
  };
}

function managedLlmCheck(): ReadinessCheck {
  const providerKeys = [
    "LLM_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "XAI_API_KEY",
    "GROK_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
  ];
  const keys = present(providerKeys);
  return {
    id: "managed-llm",
    label: "Managed LLM fallback",
    severity: "recommended",
    ok: keys.length > 0,
    missing: keys.length ? [] : [providerKeys.join(" or ")],
    notes: keys.length
      ? [`${keys.length} managed LLM key source${keys.length === 1 ? "" : "s"} configured.`]
      : ["Free-trial users may need to add BYOK providers before AI workflows can run."],
  };
}

function summaryForChecks(checks: ReadinessCheck[]) {
  const requiredMissing = checks.filter((check) => check.severity === "required" && !check.ok).length;
  const recommendedMissing = checks.filter((check) => check.severity === "recommended" && !check.ok).length;
  const optionalMissing = checks.filter((check) => check.severity === "optional" && !check.ok).length;
  return {
    ready: requiredMissing === 0,
    requiredMissing,
    recommendedMissing,
    optionalMissing,
  };
}

export async function getHostedReadiness(req: Request) {
  requireAdminSupportAccess(req);
  const checks: ReadinessCheck[] = [
    hostedFlagCheck(),
    authModeCheck(),
    checkAll({
      id: "database",
      label: "Hosted Postgres",
      severity: "required",
      names: ["DATABASE_URL"],
    }),
    checkAll({
      id: "supabase-auth",
      label: "Supabase Auth",
      severity: "required",
      names: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    }),
    checkAll({
      id: "supabase-storage",
      label: "Supabase public media storage",
      severity: "required",
      names: ["STORAGE_PROVIDER", "PILLAR_PRESS_STORAGE", "SUPABASE_URL", "SUPABASE_ANON_KEY"],
      notes: ["Generated media persistence expects the public Supabase Storage bucket used by Pillar Press."],
    }),
    checkAll({
      id: "stripe",
      label: "Stripe billing",
      severity: "required",
      names: ["APP_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_PRO"],
    }),
    checkAll({
      id: "hosted-secret-encryption",
      label: "Hosted BYOK encryption",
      severity: "required",
      names: ["PILLAR_PRESS_HOSTED_SECRET_KEY"],
    }),
    checkAll({
      id: "background-jobs",
      label: "Background worker secret",
      severity: "required",
      names: ["PILLAR_PRESS_JOB_SECRET"],
    }),
    supportSecretCheck(),
    managedLlmCheck(),
  ];

  await safeRecordAuditEvent({
    actorType: "admin",
    action: "admin.hosted_readiness.checked",
    targetType: "deployment",
    metadata: summaryForChecks(checks),
  });

  return {
    product: "pillar_press",
    mode: {
      hosted: isHostedWebMode(),
      localFirst: isLocalFirstMode(),
      authDisabled: isAuthDisabled(),
    },
    ...summaryForChecks(checks),
    checks,
  };
}

function redactString(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]{4,}/gi, "sk-[redacted]")
    .replace(/api[_-]?key[=:]\s*[^&\s]+/gi, "api_key=[redacted]")
    .replace(/password[=:]\s*[^&\s]+/gi, "password=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/https?:\/\/[^@\s/]+@/gi, "https://[redacted]@");
}

function scrub(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrub);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/(secret|token|password|api[_-]?key|encrypted|authorization|email)/i.test(key)) {
        return [key, "[redacted]"];
      }
      return [key, scrub(item)];
    }),
  );
}

function clampLimit(value: string | null, fallback = 20, max = 100) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

export function normalizeTrialExtensionDays(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    throw new BillingError(400, "bad_request", "Trial extension days are required.");
  }
  const days = Math.trunc(parsed);
  if (days < 1 || days > 90) {
    throw new BillingError(400, "bad_request", "Trial extension must be between 1 and 90 days.");
  }
  return days;
}

export async function extendSupportTrial(input: {
  req: Request;
  workspaceId: string;
  days: number;
  reason?: string | null;
}) {
  requireAdminMutationAccess(input.req);
  const days = normalizeTrialExtensionDays(input.days);
  const subscription = await getLatestSubscription(input.workspaceId);
  if (!subscription) {
    throw new BillingError(404, "subscription_not_found", "Subscription not found.");
  }
  if (subscription.planId !== "trial") {
    throw new BillingError(409, "not_trial_subscription", "Only trial subscriptions can be extended from support tools.");
  }

  const now = new Date();
  const base = subscription.trialEnd && subscription.trialEnd.getTime() > now.getTime()
    ? subscription.trialEnd
    : now;
  const trialEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  const [updated] = await db
    .update(subscriptions)
    .set({
      status: "trialing",
      trialEnd,
      currentPeriodEnd: trialEnd,
      updatedAt: now,
      metadata: {
        ...(subscription.metadata && typeof subscription.metadata === "object" && !Array.isArray(subscription.metadata)
          ? subscription.metadata as Record<string, unknown>
          : {}),
        supportExtendedAt: now.toISOString(),
      },
    })
    .where(eq(subscriptions.id, subscription.id))
    .returning();

  await db.insert(trialEvents).values({
    workspaceId: input.workspaceId,
    userId: null,
    event: "extended",
    planId: "trial",
    trialStart: updated?.trialStart ?? subscription.trialStart ?? null,
    trialEnd,
    metadata: {
      source: "admin_support",
      days,
      reason: input.reason ? redactString(input.reason).slice(0, 500) : null,
      subscriptionId: subscription.id,
    },
  });

  await safeRecordAuditEvent({
    workspaceId: input.workspaceId,
    actorType: "admin",
    action: "admin.trial.extended",
    targetType: "subscription",
    targetId: subscription.id,
    metadata: {
      planId: "trial",
      days,
      trialEnd: trialEnd.toISOString(),
      reason: input.reason ? redactString(input.reason).slice(0, 500) : null,
    },
  });

  return {
    subscription: scrub({
      id: updated?.id ?? subscription.id,
      workspaceId: input.workspaceId,
      planId: "trial",
      status: "trialing",
      trialStart: updated?.trialStart ?? subscription.trialStart ?? null,
      trialEnd,
      currentPeriodEnd: updated?.currentPeriodEnd ?? trialEnd,
    }),
  };
}

export async function listSupportWorkspaces(req: Request) {
  requireAdminSupportAccess(req);
  const url = new URL(req.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const result = await db.execute(sql`
    select
      w.id::text as "workspaceId",
      w.name as "workspaceName",
      w.created_at as "createdAt",
      w.updated_at as "updatedAt",
      coalesce(m.member_count, 0)::int as "memberCount",
      s.plan_id as "planId",
      s.status as "subscriptionStatus",
      s.trial_end as "trialEnd",
      s.current_period_end as "currentPeriodEnd",
      s.cancel_at_period_end as "cancelAtPeriodEnd",
      coalesce(p.llm_profiles, 0)::int as "llmProfileCount",
      coalesce(p.media_profiles, 0)::int as "mediaProfileCount",
      coalesce(j.queued_jobs, 0)::int as "queuedJobCount",
      coalesce(j.processing_jobs, 0)::int as "processingJobCount",
      coalesce(u.failed_usage_events, 0)::int as "failedUsageEventCount",
      coalesce(u.quota_block_events, 0)::int as "quotaBlockEventCount",
      u.last_usage_at as "lastUsageAt"
    from workspaces w
    left join lateral (
      select count(*) as member_count
      from memberships
      where memberships.workspace_id = w.id
    ) m on true
    left join lateral (
      select *
      from subscriptions
      where subscriptions.workspace_id = w.id
      order by
        case
          when plan_id <> 'trial' and status in ('active', 'trialing') then 400
          when plan_id <> 'trial' and status in ('past_due', 'unpaid', 'paused') then 300
          when plan_id <> 'trial' then 200
          when status = 'trialing' then 100
          else 0
        end desc,
        coalesce(current_period_end, trial_end, updated_at, created_at) desc
      limit 1
    ) s on true
    left join lateral (
      select
        count(*) filter (where kind = 'llm') as llm_profiles,
        count(*) filter (where kind = 'media') as media_profiles
      from provider_secrets
      where provider_secrets.workspace_id = w.id and has_api_key = true
    ) p on true
    left join lateral (
      select
        count(*) filter (where status = 'queued') as queued_jobs,
        count(*) filter (where status = 'processing') as processing_jobs
      from background_jobs
      where background_jobs.workspace_id = w.id
    ) j on true
    left join lateral (
      select
        count(*) filter (where status = 'failed') as failed_usage_events,
        count(*) filter (where error_code in ('quota_exceeded', 'storage_quota_exceeded')) as quota_block_events,
        max(created_at) as last_usage_at
      from usage_events
      where usage_events.workspace_id = w.id
        and usage_events.created_at >= now() - interval '30 days'
    ) u on true
    order by w.created_at desc
    limit ${limit}
  `);

  await safeRecordAuditEvent({
    actorType: "admin",
    action: "admin.support_workspaces.listed",
    targetType: "workspaces",
    metadata: { limit },
  });

  return { workspaces: rowsOf(result).map(scrub) };
}

export async function getSupportWorkspace(req: Request, workspaceId: string) {
  requireAdminSupportAccess(req);
  const [summary, usage, recentUsage, trialEvents, auditEvents, jobs, usageDiagnostics] = await Promise.all([
    db.execute(sql`
      select *
      from (${sql.raw("select 1")}) noop
      left join lateral (
        select
          w.id::text as "workspaceId",
          w.name as "workspaceName",
          w.created_at as "createdAt",
          w.updated_at as "updatedAt",
          coalesce(m.member_count, 0)::int as "memberCount",
          s.plan_id as "planId",
          s.status as "subscriptionStatus",
          s.trial_start as "trialStart",
          s.trial_end as "trialEnd",
          s.current_period_start as "currentPeriodStart",
          s.current_period_end as "currentPeriodEnd",
          s.cancel_at_period_end as "cancelAtPeriodEnd",
          coalesce(p.llm_profiles, 0)::int as "llmProfileCount",
          coalesce(p.media_profiles, 0)::int as "mediaProfileCount"
        from workspaces w
        left join lateral (
          select count(*) as member_count from memberships where memberships.workspace_id = w.id
        ) m on true
        left join lateral (
          select *
          from subscriptions
          where subscriptions.workspace_id = w.id
          order by
            case
              when plan_id <> 'trial' and status in ('active', 'trialing') then 400
              when plan_id <> 'trial' and status in ('past_due', 'unpaid', 'paused') then 300
              when plan_id <> 'trial' then 200
              when status = 'trialing' then 100
              else 0
            end desc,
            coalesce(current_period_end, trial_end, updated_at, created_at) desc
          limit 1
        ) s on true
        left join lateral (
          select
            count(*) filter (where kind = 'llm') as llm_profiles,
            count(*) filter (where kind = 'media') as media_profiles
          from provider_secrets
          where provider_secrets.workspace_id = w.id and has_api_key = true
        ) p on true
        where w.id = ${workspaceId}
      ) summary on true
    `),
    db.execute(sql`
      select
        period_start as "periodStart",
        period_end as "periodEnd",
        llm_credits_used as "llmCreditsUsed",
        media_generations_used as "mediaGenerationsUsed",
        gather_runs_used as "gatherRunsUsed",
        storage_bytes_used as "storageBytesUsed",
        cost_usd as "costUsd",
        updated_at as "updatedAt"
      from usage_rollups
      where workspace_id = ${workspaceId}
      order by period_end desc
      limit 6
    `),
    db.execute(sql`
      select
        id::text,
        task,
        feature,
        provider,
        model,
        status,
        estimated_credits as "estimatedCredits",
        actual_credits as "actualCredits",
        error_code as "errorCode",
        created_at as "createdAt",
        completed_at as "completedAt"
      from usage_events
      where workspace_id = ${workspaceId}
      order by created_at desc
      limit 12
    `),
    db.execute(sql`
      select event, plan_id as "planId", trial_start as "trialStart", trial_end as "trialEnd", metadata, created_at as "createdAt"
      from trial_events
      where workspace_id = ${workspaceId}
      order by created_at desc
      limit 12
    `),
    db.execute(sql`
      select actor_type as "actorType", action, target_type as "targetType", target_id as "targetId", metadata, created_at as "createdAt"
      from audit_events
      where workspace_id = ${workspaceId}
      order by created_at desc
      limit 20
    `),
    db.execute(sql`
      select id::text, kind, status, attempts, max_attempts as "maxAttempts", error_code as "errorCode", created_at as "createdAt", updated_at as "updatedAt"
      from background_jobs
      where workspace_id = ${workspaceId}
      order by created_at desc
      limit 12
    `),
    db.execute(sql`
      select
        task,
        status,
        error_code as "errorCode",
        count(*)::int as "eventCount",
        max(created_at) as "lastSeenAt"
      from usage_events
      where workspace_id = ${workspaceId}
        and created_at >= now() - interval '30 days'
      group by task, status, error_code
      order by max(created_at) desc, count(*) desc
      limit 24
    `),
  ]);

  const summaryRows = rowsOf(summary);
  const workspace = summaryRows[0] && (summaryRows[0] as Record<string, unknown>).workspaceId
    ? scrub(summaryRows[0])
    : null;

  await safeRecordAuditEvent({
    workspaceId,
    actorType: "admin",
    action: "admin.support_workspace.viewed",
    targetType: "workspace",
    targetId: workspaceId,
    metadata: {},
  });

  return {
    workspace,
    usageRollups: rowsOf(usage).map(scrub),
    recentUsageEvents: rowsOf(recentUsage).map(scrub),
    trialEvents: rowsOf(trialEvents).map(scrub),
    auditEvents: rowsOf(auditEvents).map(scrub),
    backgroundJobs: rowsOf(jobs).map(scrub),
    usageDiagnostics: rowsOf(usageDiagnostics).map(scrub),
  };
}
