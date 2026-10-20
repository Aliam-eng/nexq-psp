import { beforeEach, describe, expect, it, vi } from "vitest";

// reconcileTransaction state machine: Whish collect status -> deposit status -> MT5 credit.
// The DB is an in-memory fake that implements just the queries flow.ts uses
// (including the row-level credit claim), so the money rules run fast and deterministic.

type Row = Record<string, any>;
const db = vi.hoisted(() => ({ rows: new Map<string, Row>() }));

vi.mock("@/lib/db", () => {
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, cond]) => {
      if (k === "OR") return (cond as Row[]).some((c) => matches(row, c));
      if (cond && typeof cond === "object" && !(cond instanceof Date)) {
        if ("in" in cond) return cond.in.includes(row[k]);
        if ("lt" in cond) return row[k] != null && row[k] < cond.lt;
        if ("not" in cond) return row[k] !== cond.not;
        if ("gte" in cond) return row[k] >= cond.gte;
      }
      return row[k] === cond;
    });
  return {
    prisma: {
      transaction: {
        findUnique: async ({ where }: any) => {
          const r = db.rows.get(where.id);
          return r ? { ...r } : null;
        },
        update: async ({ where, data }: any) => {
          const r = { ...db.rows.get(where.id)!, ...data };
          db.rows.set(where.id, r);
          return { ...r };
        },
        updateMany: async ({ where, data }: any) => {
          let count = 0;
          for (const [id, r] of db.rows) {
            if (matches(r, where)) {
              db.rows.set(id, { ...r, ...data });
              count++;
            }
          }
          return { count };
        },
        findMany: async ({ where }: any) => [...db.rows.values()].filter((r) => matches(r, where)).map((r) => ({ id: r.id })),
      },
    },
  };
});

const whish = vi.hoisted(() => ({ getCollectStatus: vi.fn() }));
vi.mock("@/lib/whish", async (orig) => {
  const real = await orig<typeof import("@/lib/whish")>();
  return { ...real, getCollectStatus: whish.getCollectStatus };
});

const mt5 = vi.hoisted(() => ({ mt5Deposit: vi.fn() }));
vi.mock("@/lib/mt5", () => mt5);

import { reconcileTransaction, sweepPending } from "@/lib/flow";
import { WhishError, WhishPendingError } from "@/lib/whish";

function seed(over: Row = {}): Row {
  const row = {
    id: "t1",
    reference: "NEXQ-AAAA1111",
    mt5Login: "5000123",
    amount: 50,
    currency: "USD",
    status: "LINK_GENERATED",
    method: "WHISH",
    whishExternalId: "ext-1",
    threepayInvoiceNo: null, // real rows store an absent invoice as NULL
    mt5DealId: null,
    creditingAt: null,
    errorMessage: null,
    providerPayload: null,
    createdAt: new Date(),
    ...over,
  };
  db.rows.set(row.id, row);
  return row;
}
const row = (id = "t1") => db.rows.get(id)!;
const whishSays = (collectStatus: string) =>
  whish.getCollectStatus.mockResolvedValue({ collectStatus, payerPhoneNumber: "96170123456" });

beforeEach(() => {
  db.rows.clear();
  whish.getCollectStatus.mockReset();
  mt5.mt5Deposit.mockReset();
  mt5.mt5Deposit.mockResolvedValue({ ok: true, dealId: "D-777", message: "balance operation accepted" });
});

describe("reconcileTransaction", () => {
  it("returns null for an unknown transaction", async () => {
    expect(await reconcileTransaction("missing")).toBeNull();
  });

  it.each(["CREDITED", "FAILED"])("never touches a %s deposit", async (status) => {
    seed({ status });
    await reconcileTransaction("t1");
    expect(whish.getCollectStatus).not.toHaveBeenCalled();
    expect(mt5.mt5Deposit).not.toHaveBeenCalled();
  });

  it("does nothing before a Whish link exists", async () => {
    seed({ whishExternalId: null, status: "PENDING" });
    await reconcileTransaction("t1");
    expect(whish.getCollectStatus).not.toHaveBeenCalled();
  });

  it("queries Whish with the stored externalId and currency", async () => {
    seed({ currency: "USD" });
    whishSays("pending");
    await reconcileTransaction("t1");
    expect(whish.getCollectStatus).toHaveBeenCalledWith("ext-1", "USD");
  });

  it.each(["pending", "unknown"])("keeps waiting while Whish says '%s'", async (s) => {
    seed();
    whishSays(s);
    await reconcileTransaction("t1");
    expect(row().status).toBe("LINK_GENERATED");
    expect(mt5.mt5Deposit).not.toHaveBeenCalled();
  });

  it("success -> credits MT5 once and marks CREDITED with the deal id", async () => {
    seed();
    whishSays("success");
    const out = await reconcileTransaction("t1");
    expect(mt5.mt5Deposit).toHaveBeenCalledTimes(1);
    expect(mt5.mt5Deposit).toHaveBeenCalledWith(
      expect.objectContaining({ login: "5000123", amount: 50, currency: "USD", reference: "NEXQ-AAAA1111" })
    );
    expect(out?.status).toBe("CREDITED");
    expect(row()).toMatchObject({ status: "CREDITED", mt5DealId: "D-777", creditingAt: null, errorMessage: null });
    expect(row().providerPayload).toContain("96170123456");
  });

  it("credits the deposit amount, not the amount + fee the client paid", async () => {
    seed({ amount: 100, fee: 2.5 });
    whishSays("success");
    await reconcileTransaction("t1");
    expect(mt5.mt5Deposit.mock.calls[0][0].amount).toBe(100);
  });

  it("success but MT5 rejects -> CREDIT_FAILED with the reason, lock released", async () => {
    seed();
    whishSays("success");
    mt5.mt5Deposit.mockResolvedValue({ ok: false, message: "Account not found" });
    await reconcileTransaction("t1");
    expect(row()).toMatchObject({ status: "CREDIT_FAILED", errorMessage: "Account not found", creditingAt: null });
  });

  it("retrying a CREDIT_FAILED deposit credits it once it succeeds", async () => {
    seed({ status: "CREDIT_FAILED", errorMessage: "Account not found" });
    whishSays("success");
    await reconcileTransaction("t1");
    expect(row()).toMatchObject({ status: "CREDITED", mt5DealId: "D-777" });
  });

  it("never re-credits a deposit that already has an MT5 deal id", async () => {
    seed({ status: "PAID", mt5DealId: "D-1" });
    whishSays("success");
    await reconcileTransaction("t1");
    expect(mt5.mt5Deposit).not.toHaveBeenCalled();
  });

  it("concurrent reconciles (callback + return page + sweep) credit exactly once", async () => {
    seed();
    whishSays("success");
    mt5.mt5Deposit.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ ok: true, dealId: "D-9" }), 20))
    );
    await Promise.all([reconcileTransaction("t1"), reconcileTransaction("t1"), reconcileTransaction("t1")]);
    expect(mt5.mt5Deposit).toHaveBeenCalledTimes(1);
    expect(row()).toMatchObject({ status: "CREDITED", mt5DealId: "D-9" });
  });

  it("does not credit while another attempt holds a fresh lock", async () => {
    seed({ status: "PAID", creditingAt: new Date() });
    whishSays("success");
    await reconcileTransaction("t1");
    expect(mt5.mt5Deposit).not.toHaveBeenCalled();
  });

  it("reclaims a stale lock left by a crashed attempt", async () => {
    seed({ status: "PAID", creditingAt: new Date(Date.now() - 10 * 60 * 1000) });
    whishSays("success");
    await reconcileTransaction("t1");
    expect(mt5.mt5Deposit).toHaveBeenCalledTimes(1);
    expect(row().status).toBe("CREDITED");
  });

  it("failed (link expired unpaid) -> FAILED", async () => {
    seed();
    whishSays("failed");
    await reconcileTransaction("t1");
    expect(row()).toMatchObject({ status: "FAILED", errorMessage: "payment link expired unpaid" });
    expect(mt5.mt5Deposit).not.toHaveBeenCalled();
  });

  it("refunded before crediting -> FAILED, no credit", async () => {
    seed();
    whishSays("refunded");
    await reconcileTransaction("t1");
    expect(row()).toMatchObject({ status: "FAILED", errorMessage: "payment refunded" });
    expect(mt5.mt5Deposit).not.toHaveBeenCalled();
  });

  it.each(["failed", "refunded"])("a PAID deposit is flagged, not failed, if Whish later says '%s'", async (s) => {
    seed({ status: "PAID" });
    whishSays(s);
    await reconcileTransaction("t1");
    expect(row().status).toBe("PAID");
    expect(row().errorMessage).toMatch(/check manually/);
  });

  it("a pending envelope (code 500) on the status check changes nothing", async () => {
    seed();
    whish.getCollectStatus.mockRejectedValue(new WhishPendingError());
    await reconcileTransaction("t1");
    expect(row().status).toBe("LINK_GENERATED");
    expect(row().errorMessage).toMatch(/pending/);
  });

  it("a status-check error is recorded but never fails the deposit", async () => {
    seed();
    whish.getCollectStatus.mockRejectedValue(new WhishError("external_id.not_exists", "external_id.not_exists"));
    await reconcileTransaction("t1");
    expect(row().status).toBe("LINK_GENERATED");
    expect(row().errorMessage).toMatch(/external_id\.not_exists/);
  });
});

describe("sweepPending", () => {
  it("reconciles only recent awaiting deposits and isolates errors", async () => {
    seed({ id: "a", status: "LINK_GENERATED", whishExternalId: "e-a" });
    seed({ id: "b", status: "PAID", whishExternalId: "e-b" });
    seed({ id: "c", status: "CREDIT_FAILED", whishExternalId: "e-c" }); // left for an admin
    seed({ id: "d", status: "LINK_GENERATED", whishExternalId: null }); // no link
    seed({ id: "e", status: "LINK_GENERATED", whishExternalId: "e-e", createdAt: new Date(Date.now() - 30 * 864e5) }); // too old
    whish.getCollectStatus.mockImplementation(async (ext: string) => {
      if (ext === "e-b") throw new Error("boom");
      return { collectStatus: "pending", payerPhoneNumber: null };
    });

    const res = await sweepPending();
    expect(Object.keys(res).sort()).toEqual(["a", "b"]);
    expect(whish.getCollectStatus.mock.calls.map((c) => c[0]).sort()).toEqual(["e-a", "e-b"]);
  });
});
