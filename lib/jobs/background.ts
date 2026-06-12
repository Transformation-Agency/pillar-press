import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { backgroundJobKind } from "@/db/schema";
import { backgroundJobs, db, type BackgroundJob } from "@/lib/db";
import { isLocalFirstMode } from "@/lib/local/mode";

export type BackgroundJobKind = (typeof backgroundJobKind)[number];

export type EnqueueBackgroundJobInput = {
  workspaceId: string;
  userId?: string | null;
  campaignId?: string | null;
  pieceId?: string | null;
  kind: BackgroundJobKind;
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
  idempotencyKey?: string | null;
  payload?: unknown;
};

export type ClaimBackgroundJobInput = {
  workerId: string;
  kinds?: BackgroundJobKind[];
  now?: Date;
};

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization|credential)/i;

function cleanOptionalText(value: string | null | undefined, max = 500) {
  const next = value?.trim();
  return next ? next.slice(0, max) : null;
}

function cleanInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value ?? fallback)));
}

export function sanitizeJobData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeJobData(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeJobData(item),
  ]));
}

function errorInfo(err: unknown) {
  const typed = err as { code?: unknown; message?: unknown };
  const code = typeof typed?.code === "string" ? typed.code : "background_job_failed";
  const message = typeof typed?.message === "string" ? typed.message : String(err || "Background job failed.");
  return {
    code: code.slice(0, 120),
    message: message.slice(0, 1000),
  };
}

export async function enqueueBackgroundJob(input: EnqueueBackgroundJobInput): Promise<BackgroundJob | null> {
  if (isLocalFirstMode()) return null;
  const workspaceId = cleanOptionalText(input.workspaceId, 120);
  if (!workspaceId) throw new Error("Background jobs require a workspace.");
  const idempotencyKey = cleanOptionalText(input.idempotencyKey, 240);
  const now = new Date();
  const values = {
    workspaceId,
    userId: cleanOptionalText(input.userId, 240),
    campaignId: cleanOptionalText(input.campaignId, 120),
    pieceId: cleanOptionalText(input.pieceId, 120),
    kind: input.kind,
    status: "queued" as const,
    priority: cleanInteger(input.priority, 0, -100, 100),
    runAfter: input.runAfter ?? now,
    attempts: 0,
    maxAttempts: cleanInteger(input.maxAttempts, 3, 1, 20),
    idempotencyKey,
    payload: sanitizeJobData(input.payload ?? {}),
    result: {},
    errorCode: null,
    errorMessage: null,
    updatedAt: now,
  };

  if (idempotencyKey) {
    const [job] = await db
      .insert(backgroundJobs)
      .values(values)
      .onConflictDoUpdate({
        target: [backgroundJobs.workspaceId, backgroundJobs.idempotencyKey],
        set: { updatedAt: now },
      })
      .returning();
    return job ?? null;
  }

  const [job] = await db.insert(backgroundJobs).values(values).returning();
  return job ?? null;
}

export async function claimNextBackgroundJob(input: ClaimBackgroundJobInput): Promise<BackgroundJob | null> {
  if (isLocalFirstMode()) return null;
  const workerId = cleanOptionalText(input.workerId, 240);
  if (!workerId) throw new Error("Background job claims require a worker id.");
  const now = input.now ?? new Date();
  const queuedWhere = input.kinds?.length
    ? and(
      eq(backgroundJobs.status, "queued"),
      lte(backgroundJobs.runAfter, now),
      inArray(backgroundJobs.kind, input.kinds),
    )
    : and(eq(backgroundJobs.status, "queued"), lte(backgroundJobs.runAfter, now));
  const candidates = await db
    .select()
    .from(backgroundJobs)
    .where(queuedWhere)
    .orderBy(desc(backgroundJobs.priority), asc(backgroundJobs.runAfter), asc(backgroundJobs.createdAt))
    .limit(10);
  for (const candidate of candidates) {
    const [claimed] = await db
      .update(backgroundJobs)
      .set({
        status: "processing",
        lockedBy: workerId,
        lockedAt: now,
        attempts: candidate.attempts + 1,
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      })
      .where(and(eq(backgroundJobs.id, candidate.id), eq(backgroundJobs.status, "queued")))
      .returning();
    if (claimed) return claimed;
  }
  return null;
}

export async function completeBackgroundJob(
  job: Pick<BackgroundJob, "id">,
  result?: unknown,
): Promise<BackgroundJob | null> {
  const [updated] = await db
    .update(backgroundJobs)
    .set({
      status: "succeeded",
      result: sanitizeJobData(result ?? {}),
      lockedBy: null,
      lockedAt: null,
      errorCode: null,
      errorMessage: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backgroundJobs.id, job.id))
    .returning();
  return updated ?? null;
}

export async function failBackgroundJob(
  job: Pick<BackgroundJob, "id" | "attempts" | "maxAttempts">,
  err: unknown,
  options: { retryDelayMs?: number } = {},
): Promise<BackgroundJob | null> {
  const exhausted = job.attempts >= job.maxAttempts;
  const info = errorInfo(err);
  const now = new Date();
  const [updated] = await db
    .update(backgroundJobs)
    .set({
      status: exhausted ? "failed" : "queued",
      runAfter: exhausted ? now : new Date(now.getTime() + Math.max(0, options.retryDelayMs ?? 30_000)),
      lockedBy: null,
      lockedAt: null,
      errorCode: info.code,
      errorMessage: info.message,
      completedAt: exhausted ? now : null,
      updatedAt: now,
    })
    .where(eq(backgroundJobs.id, job.id))
    .returning();
  return updated ?? null;
}

export async function cancelBackgroundJob(job: Pick<BackgroundJob, "id">): Promise<BackgroundJob | null> {
  const now = new Date();
  const [updated] = await db
    .update(backgroundJobs)
    .set({
      status: "canceled",
      lockedBy: null,
      lockedAt: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(backgroundJobs.id, job.id))
    .returning();
  return updated ?? null;
}
