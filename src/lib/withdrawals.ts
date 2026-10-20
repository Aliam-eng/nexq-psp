import { randomUUID } from "node:crypto";
import type { Withdrawal } from "@prisma/client";
import { prisma } from "./db";
import { mt5Deposit, mt5Withdraw } from "./mt5";
import { logAudit } from "./audit";
import {
  TRC20_PAYOUT_FEE,
  createPayout,
  findRecentPayout,
  getPayout,
  getThreePayConfig,
  isTrc20Address,
  type PayoutResult,
  type PayoutStatus,
} from "./threepay";

// Client withdrawals: requested on the public page, decided in the back office.
//
//   PENDING ──approve──▶ PROCESSING ──MT5 deducted──▶ COMPLETED            (WHISH: payout to phone is manual)
//      │                     │                   └──▶ payout via 3Pay      (USDT_TRC20)
//      │                     └──MT5 error──▶ FAILED (nothing deducted) ──retry / reject
//      └──reject (reason)──▶ REJECTED
//
//   USDT payout after the MT5 deduction:
//      3Pay completed ─────────────▶ COMPLETED
//      3Pay executing / pending ───▶ PAYOUT_PENDING ──webhook / check──▶ COMPLETED | PAYOUT_FAILED
//      3Pay refused (4xx) ─────────▶ PAYOUT_FAILED  ──retry payout──▶ … | ──refund to MT5──▶ REFUNDED
//      5xx / timeout ──────────────▶ PAYOUT_UNKNOWN ──check 3Pay──▶ found: its status | not found: PAYOUT_FAILED
//
// Money moves exactly once: the MT5 deduction is idempotent per reference, payouts are only
// (re)sent when 3Pay provably has none in flight, and every step is claimed atomically.

export const METHODS = ["WHISH", "USDT_TRC20"] as const;
export type Method = (typeof METHODS)[number];
export const OPEN_STATUSES = ["PENDING", "PROCESSING", "PAYOUT_PENDING", "PAYOUT_FAILED", "PAYOUT_UNKNOWN"];
export const MIN_WITHDRAWAL = 1; // USD (Whish)
export const MIN_USDT_WITHDRAWAL = TRC20_PAYOUT_FEE + 1; // the client must receive at least 1 USDT
const LOCK_STALE_MS = 3 * 60 * 1000;
const UNKNOWN_GRACE_MS = 5 * 60 * 1000; // give 3Pay time to record a slow payout before calling it "not found"
const SYSTEM = { id: null, email: "3pay (automatic)" };

type Actor = { id: string | null; email: string };
export type WithdrawalResult =
  | { ok: true; withdrawal: Withdrawal }
  | { ok: false; code: string; message: string; withdrawal?: Withdrawal | null };

// Accepts local or international formats; stores +<digits> or <digits>.
export function normalizePhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!/^\+?\d{8,15}$/.test(s)) return null;
  return s;
}

const notActionable = async (id: string): Promise<WithdrawalResult> => {
  const current = await prisma.withdrawal.findUnique({ where: { id } });
  return {
    ok: false,
    code: current ? "NOT_ACTIONABLE" : "NOT_FOUND",
    message: current ? `This withdrawal is already ${current.status.toLowerCase().replace(/_/g, " ")}` : "Withdrawal not found",
    withdrawal: current,
  };
};

// Which payout methods clients may request (Admin → Settings, "Withdrawals" switches).
export async function withdrawalMethods(): Promise<Method[]> {
  const [whish, threepay] = await Promise.all([
    prisma.providerConfig.findUnique({ where: { id: "whish" }, select: { withdrawalsEnabled: true } }),
    getThreePayConfig(),
  ]);
  const methods: Method[] = [];
  if (whish?.withdrawalsEnabled ?? true) methods.push("WHISH");
  if (threepay.withdrawalsEnabled) methods.push("USDT_TRC20");
  return methods;
}

export async function createWithdrawal(input: {
  mt5Login: string;
  amount: number;
  method?: Method;
  phone?: string;
  walletAddress?: string;
}): Promise<WithdrawalResult> {
  const method: Method = input.method ?? "WHISH";
  let phone: string | null = null;
  let walletAddress: string | null = null;

  // Switched-off methods are refused here too, not just hidden on the page.
  if (!(await withdrawalMethods()).includes(method)) {
    return {
      ok: false,
      code: "METHOD",
      message: `${method === "USDT_TRC20" ? "USDT" : "Whish"} withdrawals are not available right now`,
    };
  }

  if (method === "USDT_TRC20") {
    if (!(input.amount >= MIN_USDT_WITHDRAWAL)) {
      return { ok: false, code: "AMOUNT", message: `Minimum USDT withdrawal is ${MIN_USDT_WITHDRAWAL.toFixed(2)} USDT` };
    }
    walletAddress = (input.walletAddress ?? "").trim();
    if (!isTrc20Address(walletAddress)) {
      return { ok: false, code: "WALLET", message: "Enter a valid USDT TRC20 address (starts with T)" };
    }
  } else {
    if (!(input.amount >= MIN_WITHDRAWAL)) {
      return { ok: false, code: "AMOUNT", message: `Minimum withdrawal is ${MIN_WITHDRAWAL.toFixed(2)} USD` };
    }
    phone = normalizePhone(input.phone ?? "");
    if (!phone) return { ok: false, code: "PHONE", message: "Enter a valid phone number" };
  }

  // One open request per account keeps the queue clean and blocks spam.
  const open = await prisma.withdrawal.findFirst({
    where: { mt5Login: input.mt5Login, status: { in: OPEN_STATUSES } },
  });
  if (open) {
    return {
      ok: false,
      code: "OPEN_REQUEST",
      message: `There is already a withdrawal under review for this account (${open.reference}).`,
    };
  }

  const withdrawal = await prisma.withdrawal.create({
    data: {
      reference: `NEXQ-W-${randomUUID().slice(0, 8).toUpperCase()}`,
      mt5Login: input.mt5Login,
      amount: Math.round(input.amount * 100) / 100,
      method,
      phone,
      walletAddress,
    },
  });
  return { ok: true, withdrawal };
}

export async function approveWithdrawal(id: string, actor: Actor): Promise<WithdrawalResult> {
  // Atomically claim it: only one approver can move it to PROCESSING. A lock left
  // by a crashed attempt is reclaimed after LOCK_STALE_MS.
  const now = new Date();
  const claim = await prisma.withdrawal.updateMany({
    where: {
      id,
      mt5DealId: null,
      status: { in: ["PENDING", "FAILED", "PROCESSING"] },
      OR: [{ processingAt: null }, { processingAt: { lt: new Date(now.getTime() - LOCK_STALE_MS) } }],
    },
    data: { status: "PROCESSING", processingAt: now, decidedById: actor.id, decidedAt: now, errorMessage: null },
  });
  if (claim.count === 0) return notActionable(id);
  const current = (await prisma.withdrawal.findUnique({ where: { id } }))!;
  await logAudit(actor, "withdrawal.approve", { type: "Withdrawal", id }, {
    reference: current.reference,
    mt5Login: current.mt5Login,
    amount: current.amount,
    method: current.method,
  });

  let result: Awaited<ReturnType<typeof mt5Withdraw>>;
  try {
    result = await mt5Withdraw({
      login: current.mt5Login,
      amount: current.amount,
      currency: current.currency,
      comment: `Withdrawal ${current.reference}`,
      reference: current.reference,
    });
  } catch (e: any) {
    result = { ok: false, message: e?.message || "MT5 withdrawal failed" };
  }

  if (!result.ok) {
    const failed = await prisma.withdrawal.update({
      where: { id },
      data: { status: "FAILED", errorMessage: result.message, processingAt: null },
    });
    await logAudit(actor, "withdrawal.fail", { type: "Withdrawal", id }, { reference: failed.reference, error: result.message });
    return { ok: false, code: "MT5", message: result.message, withdrawal: failed };
  }

  await logAudit(actor, "withdrawal.complete", { type: "Withdrawal", id }, { reference: current.reference, dealId: result.dealId });

  if (current.method !== "USDT_TRC20") {
    const done = await prisma.withdrawal.update({
      where: { id },
      data: { status: "COMPLETED", mt5DealId: result.dealId, processingAt: null, errorMessage: null },
    });
    return { ok: true, withdrawal: done };
  }

  // USDT: MT5 is deducted — record that first (so it's never deducted again), then pay out.
  await prisma.withdrawal.update({ where: { id }, data: { mt5DealId: result.dealId } });
  return sendPayout(id, actor);
}

// Send (or re-send) the 3Pay payout. Caller must hold the PROCESSING lock and the MT5
// deduction must already be recorded.
async function sendPayout(id: string, actor: Actor): Promise<WithdrawalResult> {
  const w = (await prisma.withdrawal.findUnique({ where: { id } }))!;
  const sentAt = new Date();
  const outcome: PayoutResult = await createPayout({ amount: w.amount, walletAddress: w.walletAddress ?? "" });
  return applyPayoutResult(w, outcome, sentAt, actor);
}

async function applyPayoutResult(w: Withdrawal, outcome: PayoutResult, sentAt: Date, actor: Actor): Promise<WithdrawalResult> {
  const base = { processingAt: null, payoutSentAt: sentAt };
  let updated: Withdrawal;
  switch (outcome.kind) {
    case "completed":
      updated = await prisma.withdrawal.update({
        where: { id: w.id },
        data: { ...base, status: "COMPLETED", payoutId: outcome.id, payoutTxHash: outcome.txHash, payoutFee: outcome.fee, payoutNet: outcome.net, payoutError: null },
      });
      await logAudit(actor, "withdrawal.payout_complete", { type: "Withdrawal", id: w.id }, { reference: w.reference, payoutId: outcome.id, txHash: outcome.txHash });
      return { ok: true, withdrawal: updated };
    case "in_flight":
      updated = await prisma.withdrawal.update({
        where: { id: w.id },
        data: { ...base, status: "PAYOUT_PENDING", payoutId: outcome.id, payoutError: null },
      });
      await logAudit(actor, "withdrawal.payout_sent", { type: "Withdrawal", id: w.id }, { reference: w.reference, payoutId: outcome.id, status: outcome.status });
      return { ok: true, withdrawal: updated };
    case "rejected":
      updated = await prisma.withdrawal.update({
        where: { id: w.id },
        data: { ...base, status: "PAYOUT_FAILED", payoutError: outcome.message },
      });
      await logAudit(actor, "withdrawal.payout_failed", { type: "Withdrawal", id: w.id }, { reference: w.reference, error: outcome.message });
      return { ok: false, code: "PAYOUT", message: `Deducted from MT5, but 3Pay refused the payout: ${outcome.message}`, withdrawal: updated };
    case "unknown":
      updated = await prisma.withdrawal.update({
        where: { id: w.id },
        data: { ...base, status: "PAYOUT_UNKNOWN", payoutError: outcome.message },
      });
      await logAudit(actor, "withdrawal.payout_unknown", { type: "Withdrawal", id: w.id }, { reference: w.reference, error: outcome.message });
      return {
        ok: false,
        code: "PAYOUT_UNKNOWN",
        message: `Deducted from MT5; 3Pay's answer was unclear (${outcome.message}). Use "Check 3Pay" before doing anything else.`,
        withdrawal: updated,
      };
  }
}

// PAYOUT_FAILED → send again. Only when 3Pay provably holds no payout for it (payoutId null).
export async function retryPayout(id: string, actor: Actor): Promise<WithdrawalResult> {
  const now = new Date();
  const claim = await prisma.withdrawal.updateMany({
    where: { id, method: "USDT_TRC20", status: "PAYOUT_FAILED", mt5DealId: { not: null }, payoutId: null, processingAt: null },
    data: { status: "PROCESSING", processingAt: now },
  });
  if (claim.count === 0) return notActionable(id);
  await logAudit(actor, "withdrawal.payout_retry", { type: "Withdrawal", id });
  return sendPayout(id, actor);
}

// PAYOUT_FAILED → give the money back to the MT5 account instead of paying out.
export async function refundWithdrawal(id: string, actor: Actor, reason: string): Promise<WithdrawalResult> {
  const why = reason.trim();
  if (why.length < 3) return { ok: false, code: "REASON", message: "Please give a reason for the refund" };
  const claim = await prisma.withdrawal.updateMany({
    where: { id, status: "PAYOUT_FAILED", mt5DealId: { not: null }, payoutId: null, refundDealId: null, processingAt: null },
    data: { processingAt: new Date() },
  });
  if (claim.count === 0) return notActionable(id);
  const w = (await prisma.withdrawal.findUnique({ where: { id } }))!;

  let result: Awaited<ReturnType<typeof mt5Deposit>>;
  try {
    result = await mt5Deposit({
      login: w.mt5Login,
      amount: w.amount,
      currency: w.currency,
      comment: `Refund ${w.reference}`,
      reference: `${w.reference}-R`, // own reference: MT5's duplicate check never confuses it with the deduction
    });
  } catch (e: any) {
    result = { ok: false, message: e?.message || "MT5 refund failed" };
  }
  if (!result.ok) {
    const back = await prisma.withdrawal.update({ where: { id }, data: { processingAt: null, payoutError: `Refund failed: ${result.message}` } });
    return { ok: false, code: "MT5", message: `Refund to MT5 failed: ${result.message}`, withdrawal: back };
  }
  const refunded = await prisma.withdrawal.update({
    where: { id },
    data: { status: "REFUNDED", refundDealId: result.dealId, rejectionReason: why, processingAt: null, decidedById: actor.id ?? undefined, decidedAt: new Date() },
  });
  await logAudit(actor, "withdrawal.refund", { type: "Withdrawal", id }, { reference: w.reference, amount: w.amount, dealId: result.dealId, reason: why });
  return { ok: true, withdrawal: refunded };
}

// Bring a PAYOUT_PENDING / PAYOUT_UNKNOWN withdrawal up to date with 3Pay.
export async function checkPayout(id: string, actor: Actor = SYSTEM): Promise<WithdrawalResult> {
  const w = await prisma.withdrawal.findUnique({ where: { id } });
  if (!w) return notActionable(id);
  if (w.status !== "PAYOUT_PENDING" && w.status !== "PAYOUT_UNKNOWN") return notActionable(id);

  try {
    if (w.payoutId) {
      const st = await getPayout(w.payoutId);
      if (!st) return { ok: false, code: "NOT_FOUND_AT_3PAY", message: "3Pay has no record of this payout id", withdrawal: w };
      return applyPayoutStatus(w, w.payoutId, st, actor);
    }
    // Unknown outcome and no id: look for a payout to this wallet for this amount since we tried.
    const found = await findRecentPayout(w.walletAddress ?? "", w.amount, w.payoutSentAt ?? w.updatedAt);
    if (found) return applyPayoutStatus(w, found.id, found, actor);
    if (Date.now() - (w.payoutSentAt ?? w.updatedAt).getTime() < UNKNOWN_GRACE_MS) {
      return { ok: false, code: "WAIT", message: "3Pay has no record yet — check again in a few minutes", withdrawal: w };
    }
    const failed = await prisma.withdrawal.update({
      where: { id },
      data: { status: "PAYOUT_FAILED", payoutError: "3Pay has no record of the payout — safe to retry or refund" },
    });
    await logAudit(actor, "withdrawal.payout_failed", { type: "Withdrawal", id }, { reference: w.reference, error: "not found at 3Pay" });
    return { ok: true, withdrawal: failed };
  } catch (e: any) {
    return { ok: false, code: "3PAY", message: `Couldn't reach 3Pay: ${e?.message || e}`, withdrawal: w };
  }
}

async function applyPayoutStatus(w: Withdrawal, payoutId: string, st: PayoutStatus, actor: Actor): Promise<WithdrawalResult> {
  if (st.status === "completed") {
    const done = await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: "COMPLETED", payoutId, payoutTxHash: st.txHash ?? w.payoutTxHash, payoutFee: st.fee, payoutNet: st.net, payoutError: null },
    });
    await logAudit(actor, "withdrawal.payout_complete", { type: "Withdrawal", id: w.id }, { reference: w.reference, payoutId, txHash: st.txHash });
    return { ok: true, withdrawal: done };
  }
  if (st.status === "failed" || st.status === "rejected") {
    // 3Pay restored its balance; the payout id is cleared so a retry is allowed.
    const failed = await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: "PAYOUT_FAILED", payoutId: null, payoutError: `3Pay payout ${st.status}` },
    });
    await logAudit(actor, "withdrawal.payout_failed", { type: "Withdrawal", id: w.id }, { reference: w.reference, payoutId, error: st.status });
    return { ok: true, withdrawal: failed };
  }
  const pending = await prisma.withdrawal.update({ where: { id: w.id }, data: { status: "PAYOUT_PENDING", payoutId, payoutError: null } });
  return { ok: true, withdrawal: pending };
}

// Signed 3Pay webhook for a payout.
export async function handlePayoutEvent(payoutId: string, st: PayoutStatus): Promise<WithdrawalResult> {
  const w = await prisma.withdrawal.findUnique({ where: { payoutId } });
  if (!w) return { ok: false, code: "NOT_FOUND", message: "No withdrawal for this payout id" };
  if (w.status !== "PAYOUT_PENDING" && w.status !== "PAYOUT_UNKNOWN") return { ok: true, withdrawal: w }; // already final
  return applyPayoutStatus(w, payoutId, st, SYSTEM);
}

// Background: chase in-flight / unclear USDT payouts.
export async function sweepPayouts(limit = 50) {
  const due = await prisma.withdrawal.findMany({
    where: { method: "USDT_TRC20", status: { in: ["PAYOUT_PENDING", "PAYOUT_UNKNOWN"] } },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const results: Record<string, string> = {};
  for (const { id } of due) {
    try {
      const r = await checkPayout(id);
      results[id] = r.withdrawal?.status ?? (r.ok ? "OK" : r.code);
    } catch (e: any) {
      results[id] = "ERROR";
      console.error(`[payout-sweep] ${id}: ${e?.message || e}`);
    }
  }
  return results;
}

export async function rejectWithdrawal(id: string, actor: Actor, reason: string): Promise<WithdrawalResult> {
  const why = reason.trim();
  if (why.length < 3) return { ok: false, code: "REASON", message: "Please give a reason for the rejection" };

  // Only while nothing was deducted: PENDING, or FAILED (MT5 refused the deduction).
  const claim = await prisma.withdrawal.updateMany({
    where: { id, mt5DealId: null, status: { in: ["PENDING", "FAILED"] }, processingAt: null },
    data: { status: "REJECTED", rejectionReason: why, decidedById: actor.id, decidedAt: new Date() },
  });
  if (claim.count === 0) return notActionable(id);
  const current = (await prisma.withdrawal.findUnique({ where: { id } }))!;
  await logAudit(actor, "withdrawal.reject", { type: "Withdrawal", id }, {
    reference: current.reference,
    amount: current.amount,
    reason: why,
  });
  return { ok: true, withdrawal: current };
}
