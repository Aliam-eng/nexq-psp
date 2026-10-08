import { prisma } from "./db";
import { getPayment } from "./rival";
import { mt5Deposit } from "./mt5";
import type { Transaction } from "@prisma/client";

// Reconcile one transaction with Rival, then credit MT5 if newly PAID.
// Idempotent: safe to call repeatedly (on customer return + background sweep).
export async function reconcileTransaction(txId: string): Promise<Transaction | null> {
  const tx = await prisma.transaction.findUnique({ where: { id: txId } });
  if (!tx) return null;

  // Terminal states — nothing to do.
  if (tx.status === "CREDITED" || tx.status === "FAILED") return tx;
  if (!tx.rivalPaymentId) return tx; // no link yet

  // 1) Pull latest status from Rival.
  let rival;
  try {
    rival = await getPayment(tx.rivalPaymentId);
  } catch (e: any) {
    return prisma.transaction.update({
      where: { id: tx.id },
      data: { errorMessage: `status check failed: ${e?.message || e}` },
    });
  }

  if (rival.status === "FAILED" || rival.status === "EXPIRED") {
    return prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "FAILED",
        providerPayload: JSON.stringify(rival),
        errorMessage: `payment ${rival.status.toLowerCase()}`,
      },
    });
  }

  if (rival.status !== "PAID") {
    // Still PENDING — record payload, keep waiting.
    return prisma.transaction.update({
      where: { id: tx.id },
      data: { providerPayload: JSON.stringify(rival) },
    });
  }

  // 2) PAID. Mark PAID (if not already) then attempt MT5 credit.
  if (tx.status !== "PAID" && tx.status !== "CREDIT_FAILED") {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: "PAID", providerPayload: JSON.stringify(rival) },
    });
  }

  // 3) Credit MT5 — exactly once. Atomically CLAIM the credit so concurrent
  //    polls/sweeps can't each send a TRADE_BALANCE (which caused multi-credit).
  //    updateMany is a single row-locked UPDATE: only one caller gets count===1.
  //    A lock left by a crashed attempt is reclaimed after LOCK_STALE_MS.
  const LOCK_STALE_MS = 3 * 60 * 1000;
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  const claim = await prisma.transaction.updateMany({
    where: {
      id: tx.id,
      mt5DealId: null, // never re-credit once a deal id exists
      status: { in: ["PAID", "CREDIT_FAILED"] },
      OR: [{ creditingAt: null }, { creditingAt: { lt: staleBefore } }],
    },
    data: { creditingAt: new Date() },
  });

  if (claim.count === 0) {
    // Already credited, or another request holds the lock right now — do nothing.
    return prisma.transaction.findUnique({ where: { id: tx.id } });
  }

  // We exclusively own the credit for this transaction.
  const result = await mt5Deposit({
    login: tx.mt5Login,
    amount: tx.amount,
    currency: tx.currency,
    group: null, // public deposits use the default MT5 group
    comment: `Deposit ${tx.reference}`,
    reference: tx.reference,
  });

  if (result.ok) {
    return prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "CREDITED",
        mt5DealId: result.dealId,
        mt5Message: result.message ?? null,
        errorMessage: null,
        creditingAt: null,
      },
    });
  }
  return prisma.transaction.update({
    where: { id: tx.id },
    data: { status: "CREDIT_FAILED", mt5Message: result.message, errorMessage: result.message, creditingAt: null },
  });
}

// Background sweep: reconcile ONLY awaiting deposits — those still waiting for
// payment confirmation (LINK_GENERATED) or paid-but-not-yet-credited (PAID).
// It deliberately skips terminal/failed states:
//   • CREDITED / FAILED  — already done, nothing to do.
//   • CREDIT_FAILED      — a paid deposit whose MT5 credit failed; these need a
//                          look (e.g. wrong account) rather than silent retries,
//                          so leave them to the admin "Sync" button.
// Only recent ones, so we don't keep polling Rival for ancient abandoned links.
// Errors are isolated per transaction — one bad row never breaks the whole run.
export async function sweepPending(limit = 100, maxAgeDays = 14) {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000);
  const pend = await prisma.transaction.findMany({
    where: {
      status: { in: ["LINK_GENERATED", "PAID"] },
      rivalPaymentId: { not: null },
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const results: Record<string, string> = {};
  for (const p of pend) {
    try {
      const r = await reconcileTransaction(p.id);
      if (r) results[p.id] = r.status;
    } catch (e: any) {
      results[p.id] = "ERROR";
      console.error(`[sweep] ${p.id} failed: ${e?.message || e}`);
    }
  }
  return results;
}
