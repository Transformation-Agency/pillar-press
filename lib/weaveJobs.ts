/**
 * In-memory Weave job registry (Unit U3.4).
 *
 * A weave can fan out into many model calls (one per source + brief + map + one
 * per section), so it can run long. To let the UI show progress without a DB
 * table (Foundation owns the schema and media_jobs is Hedra-specific), this is a
 * tiny process-local store: POST /api/weave kicks a job and returns its id;
 * GET /api/weave/[id] polls it.
 *
 * Scope: jobs are keyed by id and stamped with the owner's userId so the GET
 * handler can 404 on cross-user access (never reveal another user's job exists).
 *
 * Caveat (intentional, documented): this lives in module memory, so it does not
 * survive a server restart and is not shared across instances. The synchronous
 * path (POST returning the full result inline) remains fully supported and is
 * the source of truth; the job store is a convenience for long runs in a single
 * instance, matching the brief's "simple job id" allowance.
 */
import { randomUUID } from "crypto";
import type { WeaveProgress, WeaveResult } from "@/lib/weave";

export interface WeaveJob {
  id: string;
  userId: string;
  status: "running" | "done" | "error";
  progress: WeaveProgress | null;
  result: WeaveResult | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

const jobs = new Map<string, WeaveJob>();

// Drop jobs older than this on access so the map can't grow unbounded.
const TTL_MS = 30 * 60 * 1000; // 30 minutes

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) jobs.delete(id);
  }
}

export function createJob(userId: string): WeaveJob {
  sweep();
  const now = Date.now();
  const job: WeaveJob = {
    id: randomUUID(),
    userId,
    status: "running",
    progress: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

export function setProgress(id: string, progress: WeaveProgress): void {
  const job = jobs.get(id);
  if (!job) return;
  job.progress = progress;
  job.updatedAt = Date.now();
}

export function completeJob(id: string, result: WeaveResult): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "done";
  job.result = result;
  job.updatedAt = Date.now();
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "error";
  job.error = error;
  job.updatedAt = Date.now();
}

/** Fetch a job IFF it belongs to the given user; otherwise null (→ 404). */
export function getJobForUser(id: string, userId: string): WeaveJob | null {
  sweep();
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return null;
  return job;
}
