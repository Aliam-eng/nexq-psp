import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_DATABASE_URL,
  WHISH_CREDS,
  hasTestDb,
  resetDatabase,
  startMockWhish,
  type MockWhish,
} from "./helpers";

// Real API routes + real Postgres + mock Whish server: the whole deposit flow
// from "Pay with Whish" to the MT5 credit attempt. MT5 itself is stubbed.

const session = vi.hoisted(() => ({ current: null as null | { id: string; email: string; role: string } }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session.current }));

const mt5 = vi.hoisted(() => ({ mt5Deposit: vi.fn() }));
vi.mock("@/lib/mt5", () => mt5);

describe.skipIf(!hasTestDb)("deposit flow (Postgres + mock Whish)", () => {
  let whish: MockWhish;
  let prisma: typeof import("@/lib/db").prisma;
  let createDeposit: typeof import("@/app/api/deposits/route").POST;
  let callback: typeof import("@/app/api/webhooks/whish/route").GET;
  let sync: typeof import("@/app/api/deposits/[id]/sync/route").POST;
  let sweep: typeof import("@/app/api/sweep/route").POST;
  let saveConfig: typeof import("@/app/api/config/whish/route").PUT;
  let testConnection: typeof import("@/app/api/config/whish/test/route").POST;

  const post = (body: unknown) =>
    createDeposit(new Request("http://app/api/deposits", { method: "POST", body: JSON.stringify(body) }));
  const hit = (externalId: string, result = "success") =>
    callback(new Request(`http://app/api/webhooks/whish?externalId=${externalId}&result=${result}`));
  const tx = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id } });
  const createdBody = () => whish.calls.filter((c) => c.path === "/payment/whish").at(-1)!.body;
  // Guards re-check the account in the DB, so sessions must belong to real users.
  const staffSession = async (email: string, role: string) => {
    const u = await prisma.user.upsert({ where: { email }, update: { role, isActive: true }, create: { email, role, password: "x" } });
    return { id: u.id, email: u.email, role: u.role };
  };

  beforeAll(async () => {
    resetDatabase(TEST_DATABASE_URL);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.APP_BASE_URL = "https://portal.example/";
    process.env.CRON_SECRET = "cron-test-secret";
    whish = await startMockWhish();

    ({ prisma } = await import("@/lib/db"));
    ({ POST: createDeposit } = await import("@/app/api/deposits/route"));
    ({ GET: callback } = await import("@/app/api/webhooks/whish/route"));
    ({ POST: sync } = await import("@/app/api/deposits/[id]/sync/route"));
    ({ POST: sweep } = await import("@/app/api/sweep/route"));
    ({ PUT: saveConfig } = await import("@/app/api/config/whish/route"));
    ({ POST: testConnection } = await import("@/app/api/config/whish/test/route"));
  });

  afterAll(async () => {
    await whish?.close();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.transaction.deleteMany();
    await prisma.providerConfig.upsert({
      where: { id: "whish" },
      update: { baseUrl: whish.baseUrl, ...WHISH_CREDS, enabled: true, minDeposit: 10 },
      create: { id: "whish", baseUrl: whish.baseUrl, ...WHISH_CREDS, enabled: true, minDeposit: 10 },
    });
    whish.calls.length = 0;
    whish.collect.clear();
    session.current = null;
    mt5.mt5Deposit.mockReset();
    mt5.mt5Deposit.mockResolvedValue({ ok: true, dealId: "D-1001", message: "balance operation accepted" });
  });

  it("Prisma's .env loading never brings real Whish credentials into tests", async () => {
    await prisma.$queryRaw`SELECT 1`; // the client has loaded .env by now
    for (const k of ["WHISH_BASE_URL", "WHISH_CHANNEL", "WHISH_SECRET", "WHISH_WEBSITE_URL", "WHISH_USER_AGENT"]) {
      expect(process.env[k] ?? "").toBe("");
    }
  });

  describe("creating a deposit", () => {
    it("records the deposit and returns the Whish collectUrl", async () => {
      const res = await post({ mt5Login: "5000123", amount: 50 });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.collectUrl).toMatch(/^https:\/\/whish\.money\/pay\//);
      expect(body.reference).toMatch(/^NEXQ-[0-9A-F]{8}$/);

      const row = await tx(body.transactionId);
      expect(row).toMatchObject({ status: "LINK_GENERATED", mt5Login: "5000123", amount: 50, currency: "USD" });
      expect(row.whishExternalId).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.whishpayUrl).toBe(body.collectUrl);
    });

    it("sends Whish the documented request", async () => {
      const { transactionId } = await (await post({ mt5Login: "5000123", amount: 50 })).json();
      const row = await tx(transactionId);
      const b = createdBody();
      expect(b).toEqual({
        amount: "50.00",
        currency: "USD",
        invoice: `${row.reference} - MT5 5000123`,
        externalId: row.whishExternalId,
        successCallbackUrl: `https://portal.example/api/webhooks/whish?externalId=${row.whishExternalId}&result=success`,
        failureCallbackUrl: `https://portal.example/api/webhooks/whish?externalId=${row.whishExternalId}&result=failure`,
        successRedirectUrl: `https://portal.example/deposit/return?tx=${row.id}`,
        failureRedirectUrl: `https://portal.example/deposit/return?tx=${row.id}`,
      });
    });

    it("gives every deposit a unique externalId", async () => {
      await post({ mt5Login: "1", amount: 20 });
      await post({ mt5Login: "1", amount: 20 });
      const ids = whish.calls.filter((c) => c.path === "/payment/whish").map((c) => c.body.externalId);
      expect(new Set(ids).size).toBe(2);
    });

    it.each<[string, object]>([
      ["non-numeric account", { mt5Login: "abc", amount: 50 }],
      ["empty account", { mt5Login: "", amount: 50 }],
      ["negative amount", { mt5Login: "5000123", amount: -1 }],
      ["non-numeric amount", { mt5Login: "5000123", amount: "lots" }],
    ])("rejects invalid input: %s", async (_case, input) => {
      const res = await post(input);
      expect(res.status).toBe(400);
      expect(whish.calls).toHaveLength(0);
    });

    it("enforces the admin minimum deposit", async () => {
      const res = await post({ mt5Login: "5000123", amount: 9.99 });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Minimum deposit is 10.00 USD");
      expect(whish.calls).toHaveLength(0);
    });

    it("enforces Whish's own 1.00 USD floor even with no admin minimum", async () => {
      await prisma.providerConfig.update({ where: { id: "whish" }, data: { minDeposit: 0 } });
      expect((await post({ mt5Login: "5000123", amount: 0.5 })).status).toBe(400);
      expect((await post({ mt5Login: "5000123", amount: 1 })).status).toBe(200);
    });

    it("retries a pending (code 500) create once with the same externalId", async () => {
      whish.next.create = { status: false, code: "500", dialog: null, data: null };
      const res = await post({ mt5Login: "5000123", amount: 50 });
      expect(res.status).toBe(200);
      const creates = whish.calls.filter((c) => c.path === "/payment/whish");
      expect(creates).toHaveLength(2);
      expect(creates[0].body.externalId).toBe(creates[1].body.externalId);
    });

    it("shows the client Whish's message for amount errors and fails the deposit", async () => {
      whish.next.create = { status: false, code: "fail", dialog: { message: "Amount not allowed" }, data: null };
      const res = await post({ mt5Login: "5000123", amount: 50 });
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("Amount not allowed");
      const [row] = await prisma.transaction.findMany();
      expect(row).toMatchObject({ status: "FAILED", errorMessage: "fail: Amount not allowed" });
    });

    it("hides internal errors from the client but keeps them for admins", async () => {
      whish.next.create = { status: false, code: "whish_pay.missing_pricing_id", dialog: null, data: null };
      const res = await post({ mt5Login: "5000123", amount: 50 });
      expect((await res.json()).error).toBe("Payment service is temporarily unavailable. Please try again later.");
      const [row] = await prisma.transaction.findMany();
      expect(row.errorMessage).toContain("whish_pay.missing_pricing_id");
    });

    it("explains a localhost APP_BASE_URL (Whish answers HTML 403)", async () => {
      process.env.APP_BASE_URL = "http://localhost:3000";
      try {
        await post({ mt5Login: "5000123", amount: 50 });
      } finally {
        process.env.APP_BASE_URL = "https://portal.example/";
      }
      const [row] = await prisma.transaction.findMany();
      expect(row.status).toBe("FAILED");
      expect(row.errorMessage).toMatch(/HTTP 403.*APP_BASE_URL/);
    });

    it("does not create links while Whish is disabled in Settings", async () => {
      await prisma.providerConfig.update({ where: { id: "whish" }, data: { enabled: false } });
      const res = await post({ mt5Login: "5000123", amount: 50 });
      expect(res.status).toBe(502);
      expect(whish.calls).toHaveLength(0);
    });
  });

  describe("callbacks and status", () => {
    async function newDeposit(amount = 50) {
      const { transactionId } = await (await post({ mt5Login: "5000123", amount })).json();
      const row = await tx(transactionId);
      return { id: row.id, ext: row.whishExternalId! };
    }

    it("a failure callback leaves the link payable", async () => {
      const d = await newDeposit();
      const res = await hit(d.ext, "failure");
      expect(res.status).toBe(200);
      expect((await tx(d.id)).status).toBe("LINK_GENERATED");
      expect(mt5.mt5Deposit).not.toHaveBeenCalled();
    });

    it("a success callback is verified with Whish before crediting", async () => {
      const d = await newDeposit();
      // Callback claims success but Whish still says pending → no credit.
      await hit(d.ext, "success");
      expect(mt5.mt5Deposit).not.toHaveBeenCalled();
      expect((await tx(d.id)).status).toBe("LINK_GENERATED");

      whish.collect.set(d.ext, "success");
      const res = await hit(d.ext, "success");
      expect((await res.json()).status).toBe("CREDITED");
      expect(await tx(d.id)).toMatchObject({ status: "CREDITED", mt5DealId: "D-1001" });
      expect(mt5.mt5Deposit).toHaveBeenCalledWith(
        expect.objectContaining({ login: "5000123", amount: 50, reference: expect.stringMatching(/^NEXQ-/) })
      );
    });

    it("a payment that succeeds on the second attempt is credited once", async () => {
      const d = await newDeposit();
      await hit(d.ext, "failure");
      whish.collect.set(d.ext, "success");
      await hit(d.ext, "success");
      await hit(d.ext, "success"); // duplicate delivery
      await sync(new Request("http://app"), { params: { id: d.id } }); // return page poll
      expect(mt5.mt5Deposit).toHaveBeenCalledTimes(1);
    });

    it("parallel callback + return-page polls credit exactly once (real row lock)", async () => {
      const d = await newDeposit();
      whish.collect.set(d.ext, "success");
      mt5.mt5Deposit.mockImplementation(() => new Promise((r) => setTimeout(() => r({ ok: true, dealId: "D-2" }), 50)));
      await Promise.all([
        hit(d.ext),
        hit(d.ext),
        sync(new Request("http://app"), { params: { id: d.id } }),
        sync(new Request("http://app"), { params: { id: d.id } }),
      ]);
      expect(mt5.mt5Deposit).toHaveBeenCalledTimes(1);
      expect((await tx(d.id)).mt5DealId).toBe("D-2");
    });

    it("an MT5 failure leaves the deposit CREDIT_FAILED for an admin", async () => {
      const d = await newDeposit();
      whish.collect.set(d.ext, "success");
      mt5.mt5Deposit.mockResolvedValue({ ok: false, message: "Account 5000123 not found" });
      await hit(d.ext);
      expect(await tx(d.id)).toMatchObject({ status: "CREDIT_FAILED", errorMessage: "Account 5000123 not found" });
    });

    it("an expired link becomes FAILED", async () => {
      const d = await newDeposit();
      whish.collect.set(d.ext, "failed");
      await sync(new Request("http://app"), { params: { id: d.id } });
      expect(await tx(d.id)).toMatchObject({ status: "FAILED", errorMessage: "payment link expired unpaid" });
    });

    it("a pending status envelope never fails the deposit", async () => {
      const d = await newDeposit();
      whish.next.status = { status: false, code: "500", dialog: null, data: null };
      await sync(new Request("http://app"), { params: { id: d.id } });
      expect((await tx(d.id)).status).toBe("LINK_GENERATED");
    });

    it("callbacks for unknown or missing externalIds are acknowledged with 200", async () => {
      for (const url of ["http://app/api/webhooks/whish?externalId=nope", "http://app/api/webhooks/whish"]) {
        const res = await callback(new Request(url));
        expect(res.status).toBe(200);
        expect((await res.json()).matched).toBe(false);
      }
    });

    it("the public sync endpoint 404s for unknown deposits", async () => {
      const res = await sync(new Request("http://app"), { params: { id: "missing" } });
      expect(res.status).toBe(404);
    });
  });

  describe("background sweep", () => {
    it("requires an admin session or the cron secret", async () => {
      expect((await sweep(new Request("http://app/api/sweep", { method: "POST" }))).status).toBe(403);
      const wrong = new Request("http://app/api/sweep", { method: "POST", headers: { "x-cron-secret": "nope" } });
      expect((await sweep(wrong)).status).toBe(403);
    });

    it("credits paid deposits whose callback never arrived", async () => {
      const { transactionId } = await (await post({ mt5Login: "5000123", amount: 75 })).json();
      const ext = (await tx(transactionId)).whishExternalId!;
      whish.collect.set(ext, "success");

      const res = await sweep(
        new Request("http://app/api/sweep", { method: "POST", headers: { "x-cron-secret": "cron-test-secret" } })
      );
      expect(res.status).toBe(200);
      expect((await res.json()).results[transactionId]).toBe("CREDITED");
    });
  });

  describe("admin Whish settings", () => {
    it("are admin-only", async () => {
      const req = new Request("http://app/api/config/whish", { method: "PUT", body: "{}" });
      expect((await saveConfig(req)).status).toBe(403);
      session.current = await staffSession("client@example.com", "CLIENT");
      expect((await saveConfig(new Request("http://app", { method: "PUT", body: "{}" }))).status).toBe(403);
      expect((await testConnection()).status).toBe(403);
    });

    it("save credentials without ever wiping a stored secret", async () => {
      session.current = await staffSession("admin@example.com", "TECHNICAL");
      const put = (body: unknown) =>
        saveConfig(new Request("http://app/api/config/whish", { method: "PUT", body: JSON.stringify(body) }));

      let res = await put({ channel: "NEW", secret: "", minDeposit: 25, enabled: true });
      expect(await res.json()).toMatchObject({ ok: true, hasSecret: true, minDeposit: 25 });
      let cfg = await prisma.providerConfig.findUniqueOrThrow({ where: { id: "whish" } });
      expect(cfg).toMatchObject({ channel: "NEW", secret: "S3CRET", minDeposit: 25 });

      res = await put({ secret: "ROTATED" });
      cfg = await prisma.providerConfig.findUniqueOrThrow({ where: { id: "whish" } });
      expect(cfg.secret).toBe("ROTATED");
    });

    it("test connection reads the Whish balance with the saved credentials", async () => {
      session.current = await staffSession("admin@example.com", "TECHNICAL");
      expect(await (await testConnection()).json()).toEqual({ ok: true, detail: "balance USD 10439.00" });

      await prisma.providerConfig.update({ where: { id: "whish" }, data: { secret: "WRONG" } });
      const bad = await (await testConnection()).json();
      expect(bad.ok).toBe(false);
      expect(bad.detail).toMatch(/request\.invalid/);
    });
  });
});
