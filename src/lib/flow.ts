import { prisma } from "./db";
import { getCollectStatus, WhishError, WhishPendingError } from "./whish";
import { findDeposit, ThreePayError, type DepositStatus } from "./threepay";
import { mt5Deposit } from "./mt5";
import type { Transaction } from "@prisma/client";

// Reconcile one deposit with its payment rail (Whish Pay or 3Pay USDT), then credit
// MT5 if newly paid. Idempotent: safe to call repeatedly (provider callback/webhook,
// customer return page, background sweep).
export async function reconcileTransaction(txId: string): Promise<Transaction | null> {
  const tx = await prisma.transaction.findUnique({ where: { id: txId } });
  if (!tx) return null;

  // Terminal states — nothing to do.
  if (tx.status === "CREDITED" || tx.status === "FAILED") return tx;

  const stop = tx.method === "USDT_TRC20" ? await reconcileThreePay(tx) : await reconcileWhish(tx);
  if (stop) return stop; // still waiting, failed, or flagged — no credit
  return creditPaid(tx.id);
}

// Returns the updated row when there is nothing to credit; null once the deposit is PAID.
async function reconcileWhish(tx: Transaction): Promise<Transaction | null> {
  if (!tx.whishExternalId) return tx; // no link yet

  // Pull the authoritative status from Whish (callbacks are unauthenticated, so never trust them alone).
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

  // Paid. Mark PAID (if not already).
  if (tx.status !== "PAID" && tx.status !== "CREDIT_FAILED") {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: "PAID", providerPayload: payload, errorMessage: null },
    });
  }
  return null;
}

async function reconcileThreePay(tx: Transaction): Promise<Transaction | null> {
  if (tx.status === "PAID" || tx.status === "CREDIT_FAILED") return null; // already confirmed — just credit
  if (!tx.threepayInvoiceNo) return tx; // no invoice yet

  let dep: DepositStatus;
  try {
    dep = await findDeposit(tx.threepayInvoiceNo);
  } catch (e: any) {
    const detail = `3Pay status check failed: ${e instanceof ThreePayError ? e.message : e?.message || e}`;
    return prisma.transaction.update({ where: { id: tx.id }, data: { errorMessage: detail } });
  }

  if (dep.status === "confirmed") return (await applyThreePayConfirmed(tx, dep)) ? null : prisma.transaction.findUnique({ where: { id: tx.id } });
  if (dep.status === "expired" || dep.status === "failed") {
    return prisma.transaction.update({
      where: { id: tx.id },
      data: { status: "FAILED", providerPayload: JSON.stringify(dep), errorMessage: `3Pay invoice ${dep.status} unpaid` },
    });
  }
  // initiated / pending / not_found — keep waiting.
  return prisma.transaction.update({ where: { id: tx.id }, data: { providerPayload: JSON.stringify(dep), errorMessage: null } });
}

// Mark a USDT deposit PAID with the amount 3Pay actually credited us. Returns false if
// the confirmation can't be applied (e.g. nothing credited). Safe to call repeatedly.
export async function applyThreePayConfirmed(
  tx: Pick<Transaction, "id" | "amount">,
  dep: DepositStatus,
  extra: { txHash?: string | null } = {}
): Promise<boolean> {
  const gross = dep.amount ?? tx.amount;
  const credited = dep.creditedAmount ?? gross;
  if (!(credited > 0)) {
    await prisma.transaction.update({ where: { id: tx.id }, data: { errorMessage: "3Pay confirmed but credited amount is 0 — check manually" } });
    return false;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  await prisma.transaction.updateMany({
    where: { id: tx.id, status: { in: ["PENDING", "LINK_GENERATED"] } },
    data: {
      status: "PAID",
      amount: round(credited), // what MT5 is credited
      grossAmount: round(gross),
      fee: round(Math.max(0, gross - credited)),
      threepayTxId: dep.transactionId ?? undefined,
      cryptoTxHash: extra.txHash ?? undefined,
      providerPayload: JSON.stringify(dep),
      errorMessage: null,
    },
  });
  return true;
}

async function creditPaid(txId: string): Promise<Transaction | null> {
  const tx = await prisma.transaction.findUnique({ where: { id: txId } });
  if (!tx || (tx.status !== "PAID" && tx.status !== "CREDIT_FAILED")) return tx;

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
// Only recent ones, so we don't keep polling providers for ancient abandoned links.
// Errors are isolated per transaction — one bad row never breaks the whole run.
export async function sweepPending(limit = 100, maxAgeDays = 14) {
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000);
  const pend = await prisma.transaction.findMany({
    where: {
      status: { in: ["LINK_GENERATED", "PAID"] },
      OR: [{ whishExternalId: { not: null } }, { threepayInvoiceNo: { not: null } }],
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

// Signed 3Pay webhook said "confirmed": apply it and credit MT5 (exactly once).
export async function confirmThreePayDeposit(txId: string, dep: DepositStatus, txHash?: string | null): Promise<Transaction | null> {
  const tx = await prisma.transaction.findUnique({ where: { id: txId } });
  if (!tx || tx.method !== "USDT_TRC20" || tx.status === "CREDITED" || tx.status === "FAILED") return tx;
  if (!(await applyThreePayConfirmed(tx, dep, { txHash }))) return prisma.transaction.findUnique({ where: { id: txId } });
  return creditPaid(txId);
}
