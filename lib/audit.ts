import { auditEvents, db } from "@/lib/db";

export type HostedAuditActorType = "user" | "system" | "stripe" | "admin";

type HostedAuditEventInput = {
  workspaceId?: string | null;
  actorType?: HostedAuditActorType;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};

export function auditEventValues(input: HostedAuditEventInput) {
  return {
    workspaceId: input.workspaceId ?? null,
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
  };
}

export async function recordAuditEvent(input: HostedAuditEventInput) {
  await db.insert(auditEvents).values(auditEventValues(input));
}

export async function safeRecordAuditEvent(input: HostedAuditEventInput) {
  try {
    await recordAuditEvent(input);
  } catch (err) {
    console.warn("hosted_audit_failed", err instanceof Error ? err.message : String(err));
  }
}
