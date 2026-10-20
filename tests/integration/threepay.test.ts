import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { TEST_DATABASE_URL, THREEPAY_CREDS, hasTestDb, resetDatabase, startMockThreePay, type MockThreePay } from "./helpers";

// USDT (TRC20) via 3Pay end to end: real routes + Postgres + a mock 3Pay server.
// MT5 is stubbed so we can assert exactly how money moves.

const session = vi.hoisted(() => ({ current: null as null | { id: string; email: string; role: string } }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  return { ...real, getSession: async () => session.current, createSession: vi.fn() };
});
const mt5 = vi.hoisted(() => ({ mt5Deposit: vi.fn(), mt5Withdraw: vi.fn(), mt5TestConnect: vi.fn() }));
vi.mock("@/lib/mt5", () => mt5);

const WALLET = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";

describe.skipIf(!hasTestDb)("3Pay USDT deposits and payouts (Postgres + mock 3Pay)", () => {
  let tp: MockThreePay;
  let prisma: typeof import("@/lib/db").prisma;
  let createDeposit: typeof import("@/app/api/deposits/route").POST;
  let webhook: typeof import("@/app/api/webhooks/3pay/route").POST;
  let sync: typeof import("@/app/api/deposits/[id]/sync/route").POST;
  let requestWd: typeof import("@/app/api/withdrawals/route").POST;
  let approve: typeof import("@/app/api/admin/withdrawals/[id]/approve/route").POST;
  let payout: typeof import("@/app/api/admin/withdrawals/[id]/payout/route").POST;
  let reject: typeof import("@/app/api/admin/withdrawals/[id]/reject/route").POST;
  let saveConfig: typeof import("@/app/api/config/threepay/route").PUT;
  let testConfig: typeof import("@/app/api/config/threepay/test/route").POST;
  let sweep: typeof import("@/app/api/sweep/route").POST;
  let operator: { id: string; email: string; role: string };
  let admin: { id: string; email: string; role: string };

  const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
  const sign = (raw: string, secret = THREEPAY_CREDS.webhookSecret) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const hook = (event: unknown, opts: { signature?: string | null } = {}) => {
    const raw = JSON.stringify(event);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const sig = opts.signature === undefined ? sign(raw) : opts.signature;
    if (sig) headers["x-webhook-signature"] = sig;
    return webhook(new Request("http://app/api/webhooks/3pay", { method: "POST", headers, body: raw }));
  };
  const tx = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id } });
  const wd = (id: string) => prisma.withdrawal.findUniqueOrThrow({ where: { id } });
  const act = (id: string, action: string, reason?: string) => payout(new Request("http://app", json({ action, reason })), { params: { id } });
  const payoutCalls = () => tp.calls.filter((c) => c.path === "/withdrawal-request");

  async function usdtDeposit(amount = 100) {
    const res = await createDeposit(new Request("http://app/api/deposits", json({ mt5Login: "5000123", amount, method: "USDT_TRC20" })));
    const body = await res.json();
    expect(res.status).toBe(200);
    return { body, row: await tx(body.transactionId) };
  }
  async function usdtRequest(amount = 50) {
    const res = await requestWd(new Request("http://app", json({ mt5Login: "5000123", amount, method: "USDT_TRC20", walletAddress: WALLET })));
    expect(res.status).toBe(200);
    const { reference } = await res.json();
    return prisma.withdrawal.findUniqueOrThrow({ where: { reference } });
  }

  beforeAll(async () => {
    resetDatabase(TEST_DATABASE_URL);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.APP_BASE_URL = "https://portal.example";
    process.env.CRON_SECRET = "cron-secret";
    tp = await startMockThreePay();
    ({ prisma } = await import("@/lib/db"));
    ({ POST: createDeposit } = await import("@/app/api/deposits/route"));
    ({ POST: webhook } = await import("@/app/api/webhooks/3pay/route"));
    ({ POST: sync } = await import("@/app/api/deposits/[id]/sync/route"));
    ({ POST: requestWd } = await import("@/app/api/withdrawals/route"));
    ({ POST: approve } = await import("@/app/api/admin/withdrawals/[id]/approve/route"));
    ({ POST: payout } = await import("@/app/api/admin/withdrawals/[id]/payout/route"));
    ({ POST: reject } = await import("@/app/api/admin/withdrawals/[id]/reject/route"));
    ({ PUT: saveConfig } = await import("@/app/api/config/threepay/route"));
    ({ POST: testConfig } = await import("@/app/api/config/threepay/test/route"));
    ({ POST: sweep } = await import("@/app/api/sweep/route"));
  });
  afterAll(async () => {
    await tp?.close();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.withdrawal.deleteMany();
    await prisma.transaction.deleteMany();
    await prisma.user.deleteMany();
    const mk = async (email: string, role: string) => {
      const u = await prisma.user.create({ data: { email, role, password: await bcrypt.hash("password123", 4) } });
      return { id: u.id, email: u.email, role: u.role };
    };
    admin = await mk("admin@nexq.example", "TECHNICAL");
    operator = await mk("ops@nexq.example", "OPERATOR");
    await prisma.threePayConfig.upsert({
      where: { id: "threepay" },
      update: { baseUrl: tp.baseUrl, ...THREEPAY_CREDS, enabled: true, withdrawalsEnabled: true, minDeposit: 10 },
      create: { id: "threepay", baseUrl: tp.baseUrl, ...THREEPAY_CREDS, enabled: true, withdrawalsEnabled: true, minDeposit: 10 },
    });
    tp.calls.length = 0;
    tp.invoices.clear();
    tp.payouts.length = 0;
    tp.payoutMode = "completed";
    session.current = null;
    mt5.mt5Deposit.mockReset().mockResolvedValue({ ok: true, dealId: "D-DEP" });
    mt5.mt5Withdraw.mockReset().mockResolvedValue({ ok: true, dealId: "D-WD" });
  });

  // ------------------------------------------------------------------ deposits
  describe("USDT deposits", () => {
    it("creates a 3Pay invoice and returns the hosted payment page", async () => {
      const { body, row } = await usdtDeposit(100);
      expect(body.collectUrl).toMatch(/^https:\/\/pay\.mock\/checkout\//);
      expect(row).toMatchObject({ method: "USDT_TRC20", status: "LINK_GENERATED", amount: 100, grossAmount: 100 });
      expect(row.threepayInvoiceNo).toMatch(/^INV-/);
      const create = tp.calls.find((c) => c.path === "/transaction/create")!;
      expect(create.query).toMatchObject({
        amount: "100.00",
        currencyType: "USDT-TRC20",
        webhookUrl: "https://portal.example/api/webhooks/3pay",
        callbackUrl: `https://portal.example/deposit/return?tx=${row.id}`,
      });
      expect(create.body).toMatchObject({ referenceId: row.reference });
    });

    it("enforces the USDT minimum and the on/off switch", async () => {
      const low = await createDeposit(new Request("http://app", json({ mt5Login: "1", amount: 5, method: "USDT_TRC20" })));
      expect(low.status).toBe(400);
      expect((await low.json()).error).toBe("Minimum USDT deposit is 10.00 USDT");
      await prisma.threePayConfig.update({ where: { id: "threepay" }, data: { enabled: false } });
      const off = await createDeposit(new Request("http://app", json({ mt5Login: "1", amount: 50, method: "USDT_TRC20" })));
      expect(off.status).toBe(400);
      expect(tp.calls).toHaveLength(0);
    });

    it("a signed 'confirmed' webhook credits MT5 with what 3Pay credited (after its fee)", async () => {
      const { row } = await usdtDeposit(100);
      const res = await hook({ type: "deposit", status: "confirmed", invoiceNo: row.threepayInvoiceNo, clientReference: row.reference, amount: 100, fee: 1, netAmount: 99, depositedAmount: 99, blockchainTxHash: "chainhash1" });
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe("CREDITED");
      expect(mt5.mt5Deposit).toHaveBeenCalledTimes(1);
      expect(mt5.mt5Deposit).toHaveBeenCalledWith(expect.objectContaining({ login: "5000123", amount: 99, reference: row.reference }));
      expect(await tx(row.id)).toMatchObject({ status: "CREDITED", amount: 99, grossAmount: 100, fee: 1, cryptoTxHash: "chainhash1", mt5DealId: "D-DEP" });
    });

    it("duplicate webhook deliveries credit exactly once", async () => {
      const { row } = await usdtDeposit(100);
      const event = { type: "deposit", status: "confirmed", invoiceNo: row.threepayInvoiceNo, amount: 100, depositedAmount: 99 };
      await Promise.all([hook(event), hook(event), hook(event)]);
      await hook(event);
      expect(mt5.mt5Deposit).toHaveBeenCalledTimes(1);
    });

    it("rejects a forged or unsigned webhook when a secret is configured", async () => {
      const { row } = await usdtDeposit(100);
      const event = { type: "deposit", status: "confirmed", invoiceNo: row.threepayInvoiceNo, amount: 100, depositedAmount: 99 };
      expect((await hook(event, { signature: sign(JSON.stringify(event), "wrong-secret") })).status).toBe(401);
      expect((await hook(event, { signature: null })).status).toBe(401);
      expect(mt5.mt5Deposit).not.toHaveBeenCalled();
      expect((await tx(row.id)).status).toBe("LINK_GENERATED");
    });

    it("without a webhook secret, an event is only a hint: the status comes from 3Pay's API", async () => {
      await prisma.threePayConfig.update({ where: { id: "threepay" }, data: { webhookSecret: null } });
      const { row } = await usdtDeposit(100);
      // Unsigned payload claims confirmed, but 3Pay still says initiated → nothing credited.
      await hook({ type: "deposit", status: "confirmed", invoiceNo: row.threepayInvoiceNo, depositedAmount: 1000 }, { signature: null });
      expect(mt5.mt5Deposit).not.toHaveBeenCalled();
      // Once 3Pay itself reports it confirmed, the API value (not the payload's 1000) is credited.
      Object.assign(tp.invoices.get(row.threepayInvoiceNo!)!, { status: "confirmed", depositedAmount: 98.5, fee: 1.5 });
      await hook({ type: "deposit", status: "confirmed", invoiceNo: row.threepayInvoiceNo }, { signature: null });
      expect(mt5.mt5Deposit).toHaveBeenCalledWith(expect.objectContaining({ amount: 98.5 }));
    });

    it("the return page / sweep picks up a confirmed deposit even if no webhook arrives", async () => {
      const { row } = await usdtDeposit(60);
      Object.assign(tp.invoices.get(row.threepayInvoiceNo!)!, { status: "confirmed", depositedAmount: 59 });
      const res = await sync(new Request("http://app"), { params: { id: row.id } });
      expect((await res.json()).status).toBe("CREDITED");
      expect(mt5.mt5Deposit).toHaveBeenCalledWith(expect.objectContaining({ amount: 59 }));
    });

    it("an expired invoice becomes FAILED and nothing is credited", async () => {
      const { row } = await usdtDeposit(60);
      tp.invoices.get(row.threepayInvoiceNo!)!.status = "expired";
      await sync(new Request("http://app"), { params: { id: row.id } });
      expect(await tx(row.id)).toMatchObject({ status: "FAILED", errorMessage: "3Pay invoice expired unpaid" });
      expect(mt5.mt5Deposit).not.toHaveBeenCalled();
    });

    it("webhooks for unknown invoices are acknowledged (200) and ignored", async () => {
      const res = await hook({ type: "deposit", status: "confirmed", invoiceNo: "INV-nope" });
      expect(res.status).toBe(200);
      expect((await res.json()).matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------- withdrawals
  describe("USDT withdrawal requests", () => {
    it.each<[string, object, number]>([
      ["ERC20 address", { walletAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7", amount: 50 }, 400],
      ["below the 3 USDT minimum", { walletAddress: WALLET, amount: 2.5 }, 400],
      ["missing wallet", { amount: 50 }, 400],
    ])("rejects %s", async (_c, extra, status) => {
      const res = await requestWd(new Request("http://app", json({ mt5Login: "5000123", method: "USDT_TRC20", ...extra })));
      expect(res.status).toBe(status);
    });

    it("is unavailable while USDT withdrawals are switched off", async () => {
      await prisma.threePayConfig.update({ where: { id: "threepay" }, data: { withdrawalsEnabled: false } });
      const res = await requestWd(new Request("http://app", json({ mt5Login: "5000123", amount: 50, method: "USDT_TRC20", walletAddress: WALLET })));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("USDT withdrawals are not available right now");
    });

    it("deposit and withdrawal switches are independent", async () => {
      const wdReq = () => requestWd(new Request("http://app", json({ mt5Login: "5000123", amount: 50, method: "USDT_TRC20", walletAddress: WALLET })));
      const depReq = () => createDeposit(new Request("http://app", json({ mt5Login: "5000123", amount: 50, method: "USDT_TRC20" })));

      // deposits off, withdrawals on
      await prisma.threePayConfig.update({ where: { id: "threepay" }, data: { enabled: false, withdrawalsEnabled: true } });
      expect((await depReq()).status).toBe(400);
      expect((await wdReq()).status).toBe(200);

      // deposits on, withdrawals off
      await prisma.withdrawal.deleteMany();
      await prisma.threePayConfig.update({ where: { id: "threepay" }, data: { enabled: true, withdrawalsEnabled: false } });
      expect((await depReq()).status).toBe(200);
      expect((await wdReq()).status).toBe(400);
    });

    it("the withdraw page offers only methods whose withdrawal switch is on", async () => {
      const { withdrawalMethods } = await import("@/lib/withdrawals");
      const whish = (withdrawalsEnabled: boolean) =>
        prisma.providerConfig.upsert({ where: { id: "whish" }, update: { withdrawalsEnabled }, create: { id: "whish", withdrawalsEnabled } });
      const usdt = (withdrawalsEnabled: boolean) => prisma.threePayConfig.update({ where: { id: "threepay" }, data: { withdrawalsEnabled } });

      await whish(true); await usdt(true);
      expect(await withdrawalMethods()).toEqual(["WHISH", "USDT_TRC20"]);
      await whish(false);
      expect(await withdrawalMethods()).toEqual(["USDT_TRC20"]);
      await usdt(false);
      expect(await withdrawalMethods()).toEqual([]); // page shows "Withdrawals are paused"
      await whish(true);
      expect(await withdrawalMethods()).toEqual(["WHISH"]);
    });
  });

  describe("approving a USDT withdrawal", () => {
    it("deducts MT5 first, then pays out; 200 completed → COMPLETED with the tx hash", async () => {
      const w = await usdtRequest(50);
      session.current = operator;
      const res = await approve(new Request("http://app", { method: "POST" }), { params: { id: w.id } });
      expect(res.status).toBe(200);
      expect(mt5.mt5Withdraw).toHaveBeenCalledWith(expect.objectContaining({ login: "5000123", amount: 50, reference: w.reference }));
      expect(payoutCalls()[0].body).toEqual({ amount: 50, walletAddress: WALLET, currencyType: "USDT-TRC20" });
      const done = await wd(w.id);
      expect(done).toMatchObject({ status: "COMPLETED", mt5DealId: "D-WD", payoutFee: 2, payoutNet: 48 });
      expect(done.payoutTxHash).toMatch(/^hash_/);
      const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
      expect(actions).toEqual(["withdrawal.approve", "withdrawal.complete", "withdrawal.payout_complete"]);
    });

    it("if MT5 refuses, no USDT is sent", async () => {
      const w = await usdtRequest(50);
      mt5.mt5Withdraw.mockResolvedValueOnce({ ok: false, message: "Not enough money" });
      session.current = operator;
      expect((await approve(new Request("http://app", { method: "POST" }), { params: { id: w.id } })).status).toBe(502);
      expect(payoutCalls()).toHaveLength(0);
      expect((await wd(w.id)).status).toBe("FAILED");
    });

    it("202 executing → PAYOUT_PENDING, then a signed payout webhook completes it", async () => {
      tp.payoutMode = "executing";
      const w = await usdtRequest(50);
      session.current = operator;
      await approve(new Request("http://app", { method: "POST" }), { params: { id: w.id } });
      const pending = await wd(w.id);
      expect(pending).toMatchObject({ status: "PAYOUT_PENDING" });
      expect(pending.payoutId).toMatch(/^wd_/);

      const res = await hook({ type: "payout", transactionId: pending.payoutId, status: "completed", amount: 50, fee: 2, netAmount: 48, blockchainTxHash: "chainpay1" });
      expect(res.status).toBe(200);
      expect(await wd(w.id)).toMatchObject({ status: "COMPLETED", payoutTxHash: "chainpay1", payoutNet: 48 });
    });

    it("a failed payout webhook → PAYOUT_FAILED, retry sends again WITHOUT deducting MT5 twice", async () => {
      tp.payoutMode = "executing";
      const w = await usdtRequest(50);
      session.current = operator;
      await approve(new Request("http://app", { method: "POST" }), { params: { id: w.id } });
      const { payoutId } = await wd(w.id);
      await hook({ type: "payout", transactionId: payoutId, status: "failed" });
      expect(await wd(w.id)).toMatchObject({ status: "PAYOUT_FAILED", payoutId: null });

      tp.payoutMode = "completed";
      expect((await act(w.id, "retry")).status).toBe(200);
      expect(await wd(w.id)).toMatchObject({ status: "COMPLETED" });
      expect(mt5.mt5Withdraw).toHaveBeenCalledTimes(1);
      expect(payoutCalls()).toHaveLength(2);
    });

    it("3Pay refusing (400) → PAYOUT_FAILED; refund returns the money to MT5 with its own reference", async () => {
      const w = await usdtRequest(50);
      tp.next.payout = { status: 400, body: { success: false, message: "Insufficient balance. Available: 10 USDT, Requested: 50 USDT", error: "Insufficient funds" } };
      session.current = operator;
      const res = await approve(new Request("http://app", { method: "POST" }), { params: { id: w.id } });
      expect(res.status).toBe(502);
      expect((await res.json()).error).toMatch(/Deducted from MT5, but 3Pay refused/);
      expect(await wd(w.id)).toMatchObject({ status: "PAYOUT_FAILED", mt5DealId: "D-WD" });

      // Can't simply "reject" — money was already deducted.
      expect((await reject(new Request("http://app", json({ reason: "nope" })), { params: { id: w.id } })).status).toBe(409);
      expect((await act(w.id, "refund", "")).status).toBe(400); // reason required

      expect((await act(w.id, "refund", "3Pay balance too low")).status).toBe(200);
      expect(mt5.mt5Deposit).toHaveBeenCalledWith(expect.objectContaining({ login: "5000123", amount: 50, reference: `${w.reference}-R` }));
      expect(await wd(w.id)).toMatchObject({ status: "REFUNDED", refundDealId: "D-DEP", rejectionReason: "3Pay balance too low" });
      expect((await act(w.id, "refund", "again")).status).toBe(409); // never refunded twice
    });

    it("5xx → PAYOUT_UNKNOWN; retry is blocked; 'check' finds the payout 3Pay actually made", async () => {
      const w = await usdtRequest(50);
      tp.next.payout = { status: 500, body: { success: false, message: "Blockchain service unavailable" } };
      session.current = operator;
      await approve(new Request("http://app", { method: "POST" }), { params: { id: w.id } });
      expect(await wd(w.id)).toMatchObject({ status: "PAYOUT_UNKNOWN", payoutId: null });

      expect((await act(w.id, "retry")).status).toBe(409); // never blindly resend after an unclear answer
      expect((await act(w.id, "refund", "x y z")).status).toBe(409); // nor refund — it may have been paid

      // 3Pay did create it despite the 500:
      tp.payouts.push({ _id: "wd_real", walletAddress: WALLET, amount: 50, status: "completed", createdAt: new Date().toISOString(), transactionHash: "realhash" });
      expect((await act(w.id, "check")).status).toBe(200);
      expect(await wd(w.id)).toMatchObject({ status: "COMPLETED", payoutId: "wd_real", payoutTxHash: "realhash" });
      expect(payoutCalls()).toHaveLength(1);
    });

    it("5xx and 3Pay has no record: wait during the grace period, then allow a safe retry", async () => {
      const w = await usdtRequest(50);
      tp.next.payout = { status: 503, body: null };
      session.current = operator;
      await approve(new Request("http://app", { method: "POST" }), { params: { id: w.id } });

      expect((await act(w.id, "check")).status).toBe(202); // too soon to conclude
      expect((await wd(w.id)).status).toBe("PAYOUT_UNKNOWN");

      await prisma.withdrawal.update({ where: { id: w.id }, data: { payoutSentAt: new Date(Date.now() - 10 * 60 * 1000) } });
      expect((await act(w.id, "check")).status).toBe(200);
      expect(await wd(w.id)).toMatchObject({ status: "PAYOUT_FAILED" });
      expect((await act(w.id, "retry")).status).toBe(200);
      expect((await wd(w.id)).status).toBe("COMPLETED");
      expect(mt5.mt5Withdraw).toHaveBeenCalledTimes(1);
    });

    it("concurrent retries send the payout only once", async () => {
      const w = await usdtRequest(50);
      tp.next.payout = { status: 400, body: { success: false, message: "temporarily refused" } };
      session.current = operator;
      await approve(new Request("http://app", { method: "POST" }), { params: { id: w.id } });
      const results = await Promise.all([act(w.id, "retry"), act(w.id, "retry"), act(w.id, "retry")]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(payoutCalls()).toHaveLength(2); // the original refused attempt + one retry
    });

    it("the background sweep completes in-flight payouts", async () => {
      tp.payoutMode = "executing";
      const w = await usdtRequest(50);
      session.current = operator;
      await approve(new Request("http://app", { method: "POST" }), { params: { id: w.id } });
      const { payoutId } = await wd(w.id);
      Object.assign(tp.payouts.find((p) => p._id === payoutId)!, { status: "completed", transactionHash: "sweephash" });

      session.current = null;
      const res = await sweep(new Request("http://app/api/sweep", { method: "POST", headers: { "x-cron-secret": "cron-secret" } }));
      expect((await res.json()).payouts[w.id]).toBe("COMPLETED");
      expect((await wd(w.id)).payoutTxHash).toBe("sweephash");
    });

    it("payout actions are staff-only", async () => {
      const w = await usdtRequest(50);
      expect((await act(w.id, "check")).status).toBe(403);
    });
  });

  // ------------------------------------------------------------------ settings
  describe("3Pay settings", () => {
    it("admins save credentials; secrets are never logged and never wiped by a blank field", async () => {
      session.current = admin;
      const put = (b: unknown) => saveConfig(new Request("http://app", { method: "PUT", body: JSON.stringify(b) }));
      const res = await put({ apiKey: "mk_new", apiSecret: "sk_TOP_SECRET", webhookSecret: "", minDeposit: 25, enabled: true, withdrawalsEnabled: false });
      expect(await res.json()).toMatchObject({ ok: true, hasApiSecret: true, hasWebhookSecret: true, minDeposit: 25, enabled: true, withdrawalsEnabled: false });
      const cfg = await prisma.threePayConfig.findUniqueOrThrow({ where: { id: "threepay" } });
      expect(cfg).toMatchObject({ apiKey: "mk_new", apiSecret: "sk_TOP_SECRET", webhookSecret: THREEPAY_CREDS.webhookSecret });
      const [entry] = await prisma.auditLog.findMany({ where: { action: "settings.threepay" } });
      expect(entry.details).not.toContain("sk_TOP_SECRET");
    });

    it("operators can't change 3Pay settings or run the test", async () => {
      session.current = operator;
      expect((await saveConfig(new Request("http://app", { method: "PUT", body: "{}" }))).status).toBe(403);
      expect((await testConfig()).status).toBe(403);
    });

    it("test connection reads the 3Pay balance", async () => {
      session.current = admin;
      expect(await (await testConfig()).json()).toEqual({ ok: true, detail: "balance 80342.55 USDT · payouts auto-execute" });
    });
  });
});
