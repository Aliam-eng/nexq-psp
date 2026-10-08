import { prisma } from "./db";
import { webapiBalanceDeals } from "./mt5-webapi";
import { round2 } from "./fees";

export type DuplicateRow = {
  reference: string;
  login: string;
  amount: number;
  currency: string;
  count: number; // how many balance deals carry this reference
  extraCount: number; // count - 1 (the duplicates)
  extraAmount: number; // money over-credited
  tickets: string[]; // MT5 deal tickets to reverse (keep the first, reverse the rest)
  createdAt: string;
};

export type ScanResult = {
  ok: boolean;
  scannedTx: number;
  accounts: number;
  duplicates: DuplicateRow[];
  totalExtraAmount: number;
  errors: Record<string, string>; // per-login MT5 query errors
  elapsedMs: number;
  detail?: string;
};

// Read-only: for every credited deposit, ask MT5 how many balance deals carry
// its reference. 2+ = a duplicate credit. Nothing is modified in MT5.
export async function scanDuplicateCredits(): Promise<ScanResult> {
  const started = Date.now();
  const cfg = await prisma.mt5Config.findUnique({ where: { id: "mt5" } });
  if (!cfg?.mt5Server || !cfg?.mt5Login || !cfg?.mt5Password) {
    return { ok: false, scannedTx: 0, accounts: 0, duplicates: [], totalExtraAmount: 0, errors: {}, elapsedMs: 0, detail: "MT5 WebAPI not configured" };
  }

  const txns = await prisma.transaction.findMany({
    where: { status: { in: ["CREDITED", "CREDIT_FAILED", "PAID"] } },
    select: { mt5Login: true, reference: true, amount: true, currency: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Only query the accounts we deposited to, each within a tight window derived
  // from that account's own deposit dates (± a few days) — light on MT5.
  const BUFFER = 3 * 24 * 3600; // seconds
  const windows = new Map<string, { min: number; max: number }>();
  for (const t of txns) {
    const s = Math.floor(t.createdAt.getTime() / 1000);
    const w = windows.get(t.mt5Login);
    if (!w) windows.set(t.mt5Login, { min: s, max: s });
    else {
      if (s < w.min) w.min = s;
      if (s > w.max) w.max = s;
    }
  }
  const items = [...windows.entries()].map(([login, w]) => ({ login, from: w.min - BUFFER, to: w.max + BUFFER }));

  const { ok, byLogin, errors, detail } = await webapiBalanceDeals(
    { server: cfg.mt5Server, login: cfg.mt5Login, password: cfg.mt5Password, cryptMethod: cfg.cryptMethod },
    items
  );
  if (!ok) {
    return { ok: false, scannedTx: txns.length, accounts: items.length, duplicates: [], totalExtraAmount: 0, errors, elapsedMs: Date.now() - started, detail };
  }

  const duplicates: DuplicateRow[] = [];
  let totalExtra = 0;
  for (const t of txns) {
    const deals = byLogin[t.mt5Login] || [];
    const matches = deals.filter((d) => d.comment.includes(t.reference));
    if (matches.length >= 2) {
      const extraCount = matches.length - 1;
      const extraAmount = round2(extraCount * t.amount);
      totalExtra = round2(totalExtra + extraAmount);
      duplicates.push({
        reference: t.reference,
        login: t.mt5Login,
        amount: t.amount,
        currency: t.currency,
        count: matches.length,
        extraCount,
        extraAmount,
        tickets: matches.map((m) => m.deal),
        createdAt: t.createdAt.toISOString(),
      });
    }
  }

  return { ok: true, scannedTx: txns.length, accounts: items.length, duplicates, totalExtraAmount: totalExtra, errors, elapsedMs: Date.now() - started };
}
