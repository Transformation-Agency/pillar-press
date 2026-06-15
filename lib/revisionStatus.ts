import type { RevisionResult } from "@/lib/revision";

export interface RevisionProgressState {
  runId: string;
  pieceId: string;
  status: "running" | "done" | "error";
  done: number;
  total: number;
  mode: "light" | "full";
  message?: string;
  revision?: RevisionResult;
  updatedAt: number;
}

const globalForRevision = globalThis as typeof globalThis & {
  __pillarPressRevisionProgress?: Map<string, RevisionProgressState>;
};

const progress =
  globalForRevision.__pillarPressRevisionProgress ??
  (globalForRevision.__pillarPressRevisionProgress = new Map());

function key(pieceId: string, runId: string) {
  return `${pieceId}:${runId}`;
}

export function startRevisionProgress(pieceId: string, runId: string, mode: "light" | "full") {
  progress.set(key(pieceId, runId), {
    runId,
    pieceId,
    status: "running",
    done: 0,
    total: 1,
    mode,
    updatedAt: Date.now(),
  });
}

export function updateRevisionProgress(pieceId: string, runId: string, done: number, total: number) {
  const k = key(pieceId, runId);
  const current = progress.get(k);
  if (!current) return;
  progress.set(k, {
    ...current,
    done,
    total: Math.max(total || 1, 1),
    updatedAt: Date.now(),
  });
}

export function finishRevisionProgress(pieceId: string, runId: string, revision: RevisionResult) {
  const k = key(pieceId, runId);
  const current = progress.get(k);
  progress.set(k, {
    ...(current ?? {
      runId,
      pieceId,
      mode: "light" as const,
      done: 1,
      total: 1,
    }),
    status: "done",
    done: current?.total ?? 1,
    total: current?.total ?? 1,
    revision,
    updatedAt: Date.now(),
  });
}

export function failRevisionProgress(pieceId: string, runId: string, message: string) {
  const k = key(pieceId, runId);
  const current = progress.get(k);
  progress.set(k, {
    ...(current ?? {
      runId,
      pieceId,
      mode: "light" as const,
      done: 0,
      total: 1,
    }),
    status: "error",
    message,
    updatedAt: Date.now(),
  });
}

export function getRevisionProgress(pieceId: string, runId: string) {
  return progress.get(key(pieceId, runId)) ?? null;
}
