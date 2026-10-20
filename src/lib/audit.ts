import { prisma } from "./db";

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "withdrawal.approve"
  | "withdrawal.complete"
  | "withdrawal.fail"
  | "withdrawal.reject"
  | "withdrawal.payout_sent"
  | "withdrawal.payout_complete"
  | "withdrawal.payout_failed"
  | "withdrawal.payout_unknown"
  | "withdrawal.payout_retry"
  | "withdrawal.refund"
  | "settings.threepay"
  | "user.create"
  | "user.update"
  | "settings.whish"
  | "settings.mt5"
  | "settings.password";

// Append-only record of who did what in the back office. Never throws: an audit
// write failing must not undo the action it describes (it is logged instead).
export async function logAudit(
  actor: { id?: string | null; email: string },
  action: AuditAction,
  entity?: { type: string; id?: string | null },
  details?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actor.id ?? null,
        actorEmail: actor.email,
        action,
        entityType: entity?.type ?? null,
        entityId: entity?.id ?? null,
        details: details ? JSON.stringify(details) : null,
      },
    });
  } catch (e: any) {
    console.error(`[audit] failed to record ${action} by ${actor.email}: ${e?.message || e}`);
  }
}
