import { prisma } from "./db";
import { getCollectStatus, WhishError, WhishPendingError } from "./whish";
import { mt5Deposit } from "./mt5";
import type { Transaction } from "@prisma/client";

// Reconcile one transaction with Whish Pay, then credit MT5 if newly paid.
// Idempotent: safe to call repeatedly (Whish callback, customer return page, background sweep).
export async function reconcileTransaction(txId: string): Promise<Transaction | null> {
  const tx = await prisma.transaction.findUnique({ where: { id: txId } });
  if (!tx) return null;

  // Terminal states — nothing to do.
  if (tx.status === "CREDITED" || tx.status === "FAILED") return tx;
  if (!tx.whishExternalId) return tx; // no link yet

  // 1) Pull the authoritative status from Whish (callbacks are unauthenticated, so never trust them alone).
  let whish;
  try {
    whish = await getCollectStatus(tx.whishExternalId, tx.currency);
  } catch (e: any) {
    // A pending envelope or an API error tells us nothing about the payment — keep waiting.
    const detail =
      e instanceof WhishPendingError
        ? "status check pending at Whish — will retry"
        : `status check failed: ${e instanceof WhishError ? `${e.code}: ${e.message}` : e?.message || e}`;
    return prisma.transaction.update({ where: { id: tx.id }, data: { errorMessage: detail } });
  }
  const payload = JSON.stringify(whish);

  // failed = link expired unpaid; refunded = paid then refunded before we credited it.
  if (whish.collectStatus === "failed" || whish.collectStatus === "refunded") {
    if (tx.status === "LINK_GENERATED" || tx.status === "PENDING") {
      return prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: "FAILED",
          providerPayload: payload,
          errorMessage: whish.collectStatus === "failed" ? "payment link expired unpaid" : "payment refunded",
        },
      });
    }
    // Already PAID / CREDIT_FAILED: don't silently drop a paid deposit — flag it for an admin.
    return prisma.transaction.update({
      where: { id: tx.id },
      data: { providerPayload: payload, errorMessage: `Whish now reports "${whish.collectStatus}" — check manually` },
    });
  }

  if (whish.collectStatus !== "success") {
    // pending (still payable, even after a failed attempt) or unknown — keep waiting.
    return prisma.transaction.update({
      where: { id: tx.id },
      data: { providerPayload: payload, errorMessage: null },
    });
  }

  // 2) Paid. Mark PAID (if not already) then attempt MT5 credit.
  if (tx.status !== "PAID" && tx.status !== "CREDIT_FAILED") {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: "PAID", providerPayload: payload, errorMessage: null },
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
// Only recent ones, so we don't keep polling Whish for ancient abandoned links.
// Errors are isolated per transaction — one bad row never breaks the whole run.
export async function sweepPending(limit = 100, maxAgeDays = 14) {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000);
  const pend = await prisma.transaction.findMany({
    where: {
      status: { in: ["LINK_GENERATED", "PAID"] },
      whishExternalId: { not: null },
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
