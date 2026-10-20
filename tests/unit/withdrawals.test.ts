import { beforeEach, describe, expect, it, vi } from "vitest";

// Withdrawal state machine: request → approve (deduct from MT5, exactly once) / reject (with reason).
// In-memory fake DB implementing just the queries withdrawals.ts uses.

type Row = Record<string, any>;
const db = vi.hoisted(() => ({ rows: new Map<string, Row>(), audit: [] as Row[], seq: 0, whish: { withdrawalsEnabled: true } as Row | null }));

vi.mock("@/lib/db", () => {
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, cond]) => {
      if (k === "OR") return (cond as Row[]).some((c) => matches(row, c));
      if (cond && typeof cond === "object" && !(cond instanceof Date)) {
        if ("in" in cond) return cond.in.includes(row[k]);
        if ("lt" in cond) return row[k] != null && row[k] < cond.lt;
      }
      return row[k] === cond;
    });
  return {
    prisma: {
      withdrawal: {
        findFirst: async ({ where }: any) => [...db.rows.values()].find((r) => matches(r, where)) ?? null,
        findUnique: async ({ where }: any) => (db.rows.has(where.id) ? { ...db.rows.get(where.id)! } : null),
        create: async ({ data }: any) => {
          const row = { id: `w${++db.seq}`, status: "PENDING", currency: "USD", mt5DealId: null, processingAt: null, ...data };
          db.rows.set(row.id, row);
          return { ...row };
        },
        update: async ({ where, data }: any) => {
          const r = { ...db.rows.get(where.id)!, ...data };
          db.rows.set(where.id, r);
          return { ...r };
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          for (const [id, r] of db.rows) if (matches(r, where)) { db.rows.set(id, { ...r, ...data }); count++; }
          return { count };
        },
      },
      auditLog: { create: async ({ data }: any) => { db.audit.push(data); return data; } },
      providerConfig: { findUnique: async () => db.whish },
      threePayConfig: { findUnique: async () => null },
    },
  };
});

const mt5 = vi.hoisted(() => ({ mt5Withdraw: vi.fn() }));
vi.mock("@/lib/mt5", () => mt5);

import { approveWithdrawal, createWithdrawal, normalizePhone, rejectWithdrawal } from "@/lib/withdrawals";

const OPS = { id: "op1", email: "ops@nexq.example" };
const OPS2 = { id: "op2", email: "ops2@nexq.example" };
const row = (id = "w1") => db.rows.get(id)!;
const actions = () => db.audit.map((a) => a.action);

async function newRequest(over: Partial<{ mt5Login: string; amount: number; phone: string }> = {}) {
  const r = await createWithdrawal({ mt5Login: "5000123", amount: 150, phone: "+961 70 123 456", ...over });
  if (!r.ok) throw new Error(r.message);
  return r.withdrawal;
}

beforeEach(() => {
  db.rows.clear();
  db.audit.length = 0;
  db.seq = 0;
  db.whish = { withdrawalsEnabled: true };
  mt5.mt5Withdraw.mockReset();
  mt5.mt5Withdraw.mockResolvedValue({ ok: true, dealId: "D-900", message: "withdrawal accepted" });
});

describe("normalizePhone", () => {
  it.each([
    ["+961 70 123 456", "+96170123456"],
    ["70-123-456 ", "70123456"], // local 8-digit number
    ["0096170123456", "+96170123456"], // 00 prefix → +
    ["(961) 70.123.456", "96170123456"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["abc", "123", "+96170123456789012", "70 12a 456"])("rejects %s", (bad) => {
    expect(normalizePhone(bad)).toBeNull();
  });
});

describe("createWithdrawal", () => {
  it("creates a PENDING request with a NEXQ-W reference and normalised phone", async () => {
    const w = await newRequest();
    expect(w).toMatchObject({ status: "PENDING", mt5Login: "5000123", amount: 150, phone: "+96170123456" });
    expect(w.reference).toMatch(/^NEXQ-W-[0-9A-F]{8}$/);
  });

  it("rounds the amount to cents", async () => {
    expect((await newRequest({ amount: 10.005 })).amount).toBe(10.01);
  });

  it("enforces the minimum and a valid phone", async () => {
    expect(await createWithdrawal({ mt5Login: "1", amount: 0.5, phone: "+96170123456" })).toMatchObject({ ok: false, code: "AMOUNT" });
    expect(await createWithdrawal({ mt5Login: "1", amount: 50, phone: "12" })).toMatchObject({ ok: false, code: "PHONE" });
  });

  it("allows only one open request per MT5 account", async () => {
    const first = await newRequest();
    const second = await createWithdrawal({ mt5Login: "5000123", amount: 20, phone: "+96170123456" });
    expect(second).toMatchObject({ ok: false, code: "OPEN_REQUEST" });
    if (!second.ok) expect(second.message).toContain(first.reference);
    // a different account is fine
    expect((await createWithdrawal({ mt5Login: "777", amount: 20, phone: "+96170123456" })).ok).toBe(true);
  });

  it("refuses Whish requests while Whish withdrawals are switched off", async () => {
    db.whish = { withdrawalsEnabled: false };
    expect(await createWithdrawal({ mt5Login: "1", amount: 50, phone: "+96170123456" })).toMatchObject({
      ok: false,
      code: "METHOD",
      message: "Whish withdrawals are not available right now",
    });
    expect(db.rows.size).toBe(0);
  });

  it("treats a missing Whish settings row as withdrawals on (the column default)", async () => {
    db.whish = null;
    expect((await createWithdrawal({ mt5Login: "1", amount: 50, phone: "+96170123456" })).ok).toBe(true);
  });

  it("allows a new request once the previous one is decided", async () => {
    const first = await newRequest();
    await rejectWithdrawal(first.id, OPS, "Duplicate request");
    expect((await createWithdrawal({ mt5Login: "5000123", amount: 20, phone: "+96170123456" })).ok).toBe(true);
  });
});

describe("approveWithdrawal", () => {
  it("deducts from MT5 with the reference, marks COMPLETED and logs who did it", async () => {
    const w = await newRequest();
    const r = await approveWithdrawal(w.id, OPS);
    expect(r.ok).toBe(true);
    expect(mt5.mt5Withdraw).toHaveBeenCalledWith({
      login: "5000123",
      amount: 150,
      currency: "USD",
      comment: `Withdrawal ${w.reference}`,
      reference: w.reference,
    });
    expect(row()).toMatchObject({ status: "COMPLETED", mt5DealId: "D-900", decidedById: "op1", processingAt: null });
    expect(row().decidedAt).toBeInstanceOf(Date);
    expect(actions()).toEqual(["withdrawal.approve", "withdrawal.complete"]);
    expect(db.audit.every((a) => a.actorEmail === OPS.email && a.entityId === w.id)).toBe(true);
  });

  it("MT5 refusal → FAILED with the reason; nothing is marked completed", async () => {
    const w = await newRequest();
    mt5.mt5Withdraw.mockResolvedValue({ ok: false, message: "TRADE_BALANCE failed: Not enough money" });
    const r = await approveWithdrawal(w.id, OPS);
    expect(r).toMatchObject({ ok: false, code: "MT5", message: "TRADE_BALANCE failed: Not enough money" });
    expect(row()).toMatchObject({ status: "FAILED", mt5DealId: null, processingAt: null });
    expect(actions()).toEqual(["withdrawal.approve", "withdrawal.fail"]);
  });

  it("an MT5 exception is treated as a failure, not left PROCESSING", async () => {
    const w = await newRequest();
    mt5.mt5Withdraw.mockRejectedValue(new Error("MT5 is not configured"));
    await approveWithdrawal(w.id, OPS);
    expect(row()).toMatchObject({ status: "FAILED", errorMessage: "MT5 is not configured", processingAt: null });
  });

  it("a FAILED withdrawal can be retried", async () => {
    const w = await newRequest();
    mt5.mt5Withdraw.mockResolvedValueOnce({ ok: false, message: "connect timeout" });
    await approveWithdrawal(w.id, OPS);
    const r = await approveWithdrawal(w.id, OPS2);
    expect(r.ok).toBe(true);
    expect(row()).toMatchObject({ status: "COMPLETED", decidedById: "op2", errorMessage: null });
    expect(mt5.mt5Withdraw).toHaveBeenCalledTimes(2); // MT5's own reference check prevents a double deduction
  });

  it("two staff approving at the same time deduct exactly once", async () => {
    const w = await newRequest();
    mt5.mt5Withdraw.mockImplementation(() => new Promise((res) => setTimeout(() => res({ ok: true, dealId: "D-1" }), 20)));
    const results = await Promise.all([approveWithdrawal(w.id, OPS), approveWithdrawal(w.id, OPS2), approveWithdrawal(w.id, OPS)]);
    expect(mt5.mt5Withdraw).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === "NOT_ACTIONABLE")).toBe(true);
    expect(row().status).toBe("COMPLETED");
  });

  it.each(["COMPLETED", "REJECTED"])("a %s withdrawal can't be approved", async (status) => {
    const w = await newRequest();
    db.rows.set(w.id, { ...row(), status, mt5DealId: status === "COMPLETED" ? "D-5" : null });
    expect(await approveWithdrawal(w.id, OPS)).toMatchObject({ ok: false, code: "NOT_ACTIONABLE" });
    expect(mt5.mt5Withdraw).not.toHaveBeenCalled();
  });

  it("reclaims a stale PROCESSING lock (crashed attempt) but not a fresh one", async () => {
    const w = await newRequest();
    db.rows.set(w.id, { ...row(), status: "PROCESSING", processingAt: new Date() });
    expect(await approveWithdrawal(w.id, OPS)).toMatchObject({ ok: false, code: "NOT_ACTIONABLE" });
    db.rows.set(w.id, { ...row(), processingAt: new Date(Date.now() - 10 * 60 * 1000) });
    expect((await approveWithdrawal(w.id, OPS)).ok).toBe(true);
  });

  it("unknown id → NOT_FOUND", async () => {
    expect(await approveWithdrawal("nope", OPS)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("rejectWithdrawal", () => {
  it("records the reason and who rejected it; nothing is deducted", async () => {
    const w = await newRequest();
    const r = await rejectWithdrawal(w.id, OPS, "  Phone number doesn't match  ");
    expect(r.ok).toBe(true);
    expect(row()).toMatchObject({ status: "REJECTED", rejectionReason: "Phone number doesn't match", decidedById: "op1" });
    expect(mt5.mt5Withdraw).not.toHaveBeenCalled();
    expect(db.audit).toEqual([
      expect.objectContaining({ action: "withdrawal.reject", actorEmail: OPS.email, entityId: w.id }),
    ]);
    expect(JSON.parse(db.audit[0].details)).toMatchObject({ reason: "Phone number doesn't match", amount: 150 });
  });

  it.each(["", "  ", "no"])("requires a real reason (%j)", async (reason) => {
    const w = await newRequest();
    expect(await rejectWithdrawal(w.id, OPS, reason)).toMatchObject({ ok: false, code: "REASON" });
    expect(row().status).toBe("PENDING");
  });

  it("a FAILED withdrawal (MT5 refused) can be rejected", async () => {
    const w = await newRequest();
    mt5.mt5Withdraw.mockResolvedValue({ ok: false, message: "Not enough money" });
    await approveWithdrawal(w.id, OPS);
    expect((await rejectWithdrawal(w.id, OPS, "Insufficient free margin")).ok).toBe(true);
  });

  it.each([
    ["COMPLETED", { mt5DealId: "D-1" }],
    ["PROCESSING", { processingAt: new Date() }],
    ["REJECTED", {}],
  ])("a %s withdrawal can't be rejected", async (status, extra) => {
    const w = await newRequest();
    db.rows.set(w.id, { ...row(), status, ...extra });
    expect(await rejectWithdrawal(w.id, OPS, "Too late")).toMatchObject({ ok: false, code: "NOT_ACTIONABLE" });
  });
});
