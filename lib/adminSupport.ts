import { sql } from "drizzle-orm";
import { safeRecordAuditEvent } from "@/lib/audit";
import { BillingError } from "@/lib/billing/stripe";
import { db } from "@/lib/db";

type QueryResult = { rows?: unknown[] } | unknown[];

function rowsOf<T = Record<string, unknown>>(result: QueryResult): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function adminSecret() {
  return process.env.KINGS_PRESS_ADMIN_SECRET?.trim() || process.env.KINGS_PRESS_SUPPORT_SECRET?.trim() || "";
}

export function requireAdminSupportAccess(req: Request) {
  const secret = adminSecret();
  if (!secret) {
    throw new BillingError(503, "admin_not_configured", "Admin support tools are not configured.");
  }
  const bearer = req.headers.get("authorization")?.replace(/^bearer\s+/i, "").trim();
  const header = req.headers.get("x-kings-press-admin-secret")?.trim();
  if (bearer !== secret && header !== secret) {
    throw new BillingError(401, "unauthorized", "Unauthorized.");
  }
}

function redactString(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]{8,}/gi, "sk-[redacted]")
    .replace(/api[_-]?key[=:]\s*[^&\s]+/gi, "api_key=[redacted]")
    .replace(/password[=:]\s*[^&\s]+/gi, "password=[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/https?:\/\/[^@\s/]+@/gi, "https://[redacted]@");
}

function scrub(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
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
      coalesce(j.processing_jobs, 0)::int as "processingJobCount"
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
  const [summary, usage, recentUsage, trialEvents, auditEvents, jobs] = await Promise.all([
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
  };
}
