import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { TEST_DATABASE_URL, hasTestDb, resetDatabase } from "./helpers";

// Real routes + Postgres: client withdrawal requests, staff approve/reject with an
// audit trail, back-office accounts and roles. MT5 is stubbed; the session cookie
// is faked, but the guards still check each account in the database.

const session = vi.hoisted(() => ({ current: null as null | { id: string; email: string; role: string } }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  return { ...real, getSession: async () => session.current, createSession: vi.fn() };
});

const mt5 = vi.hoisted(() => ({ mt5Withdraw: vi.fn(), mt5Deposit: vi.fn(), mt5TestConnect: vi.fn() }));
vi.mock("@/lib/mt5", () => mt5);

describe.skipIf(!hasTestDb)("withdrawals, staff and audit (Postgres)", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let requestWd: typeof import("@/app/api/withdrawals/route").POST;
  let approve: typeof import("@/app/api/admin/withdrawals/[id]/approve/route").POST;
  let reject: typeof import("@/app/api/admin/withdrawals/[id]/reject/route").POST;
  let createUser: typeof import("@/app/api/admin/users/route").POST;
  let updateUser: typeof import("@/app/api/admin/users/[id]/route").PATCH;
  let saveWhish: typeof import("@/app/api/config/whish/route").PUT;
  let login: typeof import("@/app/api/auth/login/route").POST;

  const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
  const ask = (body: unknown) => requestWd(new Request("http://app/api/withdrawals", json(body)));
  const doApprove = (id: string) => approve(new Request("http://app", { method: "POST" }), { params: { id } });
  const doReject = (id: string, reason: unknown) => reject(new Request("http://app", json({ reason })), { params: { id } });
  const audit = (action?: string) => prisma.auditLog.findMany({ where: action ? { action } : {}, orderBy: { createdAt: "asc" } });

  let admin: { id: string; email: string; role: string };
  let operator: { id: string; email: string; role: string };
  const as = (u: { id: string; email: string; role: string } | null) => (session.current = u);

  async function makeUser(email: string, role: string, password = "password123", isActive = true) {
    const u = await prisma.user.create({ data: { email, role, isActive, password: await bcrypt.hash(password, 4) } });
    return { id: u.id, email: u.email, role: u.role };
  }
  async function newRequest(mt5Login = "5000123", amount = 150) {
    const res = await ask({ mt5Login, amount, phone: "+961 70 123 456" });
    expect(res.status).toBe(200);
    const { reference } = await res.json();
    return prisma.withdrawal.findUniqueOrThrow({ where: { reference } });
  }

  beforeAll(async () => {
    resetDatabase(TEST_DATABASE_URL);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    ({ POST: requestWd } = await import("@/app/api/withdrawals/route"));
    ({ POST: approve } = await import("@/app/api/admin/withdrawals/[id]/approve/route"));
    ({ POST: reject } = await import("@/app/api/admin/withdrawals/[id]/reject/route"));
    ({ POST: createUser } = await import("@/app/api/admin/users/route"));
    ({ PATCH: updateUser } = await import("@/app/api/admin/users/[id]/route"));
    ({ PUT: saveWhish } = await import("@/app/api/config/whish/route"));
    ({ POST: login } = await import("@/app/api/auth/login/route"));
  });
  afterAll(async () => prisma?.$disconnect());

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.withdrawal.deleteMany();
    await prisma.user.deleteMany();
    admin = await makeUser("admin@nexq.example", "TECHNICAL");
    operator = await makeUser("ops@nexq.example", "OPERATOR");
    as(null);
    mt5.mt5Withdraw.mockReset();
    mt5.mt5Withdraw.mockResolvedValue({ ok: true, dealId: "D-555", message: "withdrawal accepted" });
  });

  describe("client request (public)", () => {
    it("creates a pending request with a reference", async () => {
      const res = await ask({ mt5Login: "5000123", amount: 150, phone: "+961 70 123 456" });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ ok: true, amount: 150, currency: "USD" });
      expect(body.reference).toMatch(/^NEXQ-W-[0-9A-F]{8}$/);
      const w = await prisma.withdrawal.findUniqueOrThrow({ where: { reference: body.reference } });
      expect(w).toMatchObject({ status: "PENDING", mt5Login: "5000123", phone: "+96170123456" });
      expect(mt5.mt5Withdraw).not.toHaveBeenCalled(); // nothing moves until approval
    });

    it.each<[string, object]>([
      ["non-numeric account", { mt5Login: "abc", amount: 50, phone: "+96170123456" }],
      ["below minimum", { mt5Login: "1", amount: 0.5, phone: "+96170123456" }],
      ["bad phone", { mt5Login: "1", amount: 50, phone: "12345x" }],
      ["missing phone", { mt5Login: "1", amount: 50 }],
    ])("rejects invalid input: %s", async (_c, body) => {
      expect((await ask(body)).status).toBe(400);
      expect(await prisma.withdrawal.count()).toBe(0);
    });

    it("only one open request per account (409)", async () => {
      await newRequest();
      const res = await ask({ mt5Login: "5000123", amount: 20, phone: "+96170123456" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/already a withdrawal under review/);
    });
  });

  describe("approve", () => {
    it("is staff-only", async () => {
      const w = await newRequest();
      expect((await doApprove(w.id)).status).toBe(403);
      as({ id: "ghost", email: "ghost@x", role: "TECHNICAL" }); // valid-looking cookie, no such account
      expect((await doApprove(w.id)).status).toBe(403);
      expect(mt5.mt5Withdraw).not.toHaveBeenCalled();
    });

    it("an operator approves → deducted from MT5, completed, logged with their email", async () => {
      const w = await newRequest();
      as(operator);
      const res = await doApprove(w.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, status: "COMPLETED", mt5DealId: "D-555" });
      expect(mt5.mt5Withdraw).toHaveBeenCalledWith(expect.objectContaining({ login: "5000123", amount: 150, reference: w.reference }));

      const done = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
      expect(done).toMatchObject({ status: "COMPLETED", mt5DealId: "D-555", decidedById: operator.id });
      const log = await audit();
      expect(log.map((a) => [a.action, a.actorEmail])).toEqual([
        ["withdrawal.approve", "ops@nexq.example"],
        ["withdrawal.complete", "ops@nexq.example"],
      ]);
    });

    it("MT5 refusal → 502, FAILED with the reason, retry possible", async () => {
      const w = await newRequest();
      as(admin);
      mt5.mt5Withdraw.mockResolvedValueOnce({ ok: false, message: "TRADE_BALANCE failed: Not enough money" });
      const res = await doApprove(w.id);
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("TRADE_BALANCE failed: Not enough money");
      expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("FAILED");

      expect((await doApprove(w.id)).status).toBe(200); // retry succeeds
      expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("COMPLETED");
    });

    it("two staff approving at once deduct exactly once (real row lock)", async () => {
      const w = await newRequest();
      mt5.mt5Withdraw.mockImplementation(() => new Promise((r) => setTimeout(() => r({ ok: true, dealId: "D-1" }), 50)));
      as(operator);
      const results = await Promise.all([doApprove(w.id), doApprove(w.id), doApprove(w.id)]);
      expect(mt5.mt5Withdraw).toHaveBeenCalledTimes(1);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    });

    it("a completed withdrawal can't be approved again (409)", async () => {
      const w = await newRequest();
      as(admin);
      await doApprove(w.id);
      expect((await doApprove(w.id)).status).toBe(409);
      expect(mt5.mt5Withdraw).toHaveBeenCalledTimes(1);
    });

    it("unknown id → 404", async () => {
      as(admin);
      expect((await doApprove("missing")).status).toBe(404);
    });
  });

  describe("reject", () => {
    it("requires a reason", async () => {
      const w = await newRequest();
      as(operator);
      expect((await doReject(w.id, "")).status).toBe(400);
      expect((await doReject(w.id, undefined)).status).toBe(400);
      expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("PENDING");
    });

    it("stores the reason and who rejected it, and logs it", async () => {
      const w = await newRequest();
      as(operator);
      expect((await doReject(w.id, "Phone number doesn't match our records")).status).toBe(200);
      const r = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
      expect(r).toMatchObject({ status: "REJECTED", rejectionReason: "Phone number doesn't match our records", decidedById: operator.id });
      const [entry] = await audit("withdrawal.reject");
      expect(entry.actorEmail).toBe("ops@nexq.example");
      expect(JSON.parse(entry.details!)).toMatchObject({ reason: "Phone number doesn't match our records" });
      expect(mt5.mt5Withdraw).not.toHaveBeenCalled();
    });

    it("a completed withdrawal can't be rejected (409)", async () => {
      const w = await newRequest();
      as(admin);
      await doApprove(w.id);
      expect((await doReject(w.id, "Changed my mind")).status).toBe(409);
    });

    it("after a rejection the client can request again", async () => {
      const w = await newRequest();
      as(admin);
      await doReject(w.id, "Duplicate request");
      as(null);
      expect((await ask({ mt5Login: "5000123", amount: 20, phone: "+96170123456" })).status).toBe(200);
    });
  });

  describe("back-office accounts", () => {
    const put = (body: unknown) => createUser(new Request("http://app/api/admin/users", json(body)));
    const patch = (id: string, body: unknown) =>
      updateUser(new Request("http://app", { method: "PATCH", body: JSON.stringify(body) }), { params: { id } });

    it("an admin creates an operator who can then sign in", async () => {
      as(admin);
      const res = await put({ email: "New.Ops@Nexq.example", name: "New Ops", role: "OPERATOR", password: "s3cure-pass" });
      expect(res.status).toBe(200);
      const u = await prisma.user.findUniqueOrThrow({ where: { email: "new.ops@nexq.example" } });
      expect(u).toMatchObject({ role: "OPERATOR", isActive: true, name: "New Ops" });
      expect(u.password).not.toBe("s3cure-pass"); // hashed
      const [entry] = await audit("user.create");
      expect(entry.actorEmail).toBe("admin@nexq.example");

      as(null);
      const signIn = await login(new Request("http://app", json({ email: "new.ops@nexq.example", password: "s3cure-pass" })));
      expect(signIn.status).toBe(200);
      expect(await signIn.json()).toEqual({ ok: true, role: "OPERATOR" });
      expect((await audit("auth.login")).map((a) => a.actorEmail)).toEqual(["new.ops@nexq.example"]);
    });

    it("rejects duplicate emails, weak passwords and unknown roles", async () => {
      as(admin);
      expect((await put({ email: "ops@nexq.example", role: "OPERATOR", password: "password123" })).status).toBe(409);
      expect((await put({ email: "x@nexq.example", role: "OPERATOR", password: "short" })).status).toBe(400);
      expect((await put({ email: "y@nexq.example", role: "CLIENT", password: "password123" })).status).toBe(400);
    });

    it("operators can't manage accounts or change settings", async () => {
      as(operator);
      expect((await put({ email: "z@nexq.example", role: "TECHNICAL", password: "password123" })).status).toBe(403);
      expect((await patch(admin.id, { isActive: false })).status).toBe(403);
      expect((await saveWhish(new Request("http://app", { method: "PUT", body: JSON.stringify({ minDeposit: 1 }) }))).status).toBe(403);
    });

    it("disabling an account locks it out immediately — even with a live session", async () => {
      const w = await newRequest();
      as(admin);
      expect((await patch(operator.id, { isActive: false })).status).toBe(200);

      as(operator); // their old cookie is still "valid"
      expect((await doApprove(w.id)).status).toBe(403);
      as(null);
      const signIn = await login(new Request("http://app", json({ email: "ops@nexq.example", password: "password123" })));
      expect(signIn.status).toBe(401);
      expect((await audit("auth.login_failed")).map((a) => a.actorEmail)).toContain("ops@nexq.example");
      const [entry] = await audit("user.update");
      expect(JSON.parse(entry.details!)).toMatchObject({ email: "ops@nexq.example", active: false });
    });

    it("an admin can't lock themselves out, and the last admin is protected", async () => {
      as(admin);
      expect((await patch(admin.id, { isActive: false })).status).toBe(400);
      expect((await patch(admin.id, { role: "OPERATOR" })).status).toBe(400);

      const second = await makeUser("admin2@nexq.example", "TECHNICAL");
      as(second);
      expect((await patch(admin.id, { role: "OPERATOR" })).status).toBe(200); // another admin remains
      as(second);
      expect((await patch(second.id, { isActive: false })).status).toBe(400); // can't disable self
    });

    it("password reset is logged without the password", async () => {
      as(admin);
      expect((await patch(operator.id, { password: "brand-new-pass" })).status).toBe(200);
      const [entry] = await audit("user.update");
      expect(entry.details).not.toContain("brand-new-pass");
      expect(JSON.parse(entry.details!)).toMatchObject({ passwordReset: true });
    });
  });

  it("settings changes are logged by field name only — never secret values", async () => {
    as(admin);
    const res = await saveWhish(new Request("http://app", { method: "PUT", body: JSON.stringify({ secret: "TOP-SECRET-VALUE", minDeposit: 5 }) }));
    expect(res.status).toBe(200);
    const [entry] = await audit("settings.whish");
    expect(entry.details).not.toContain("TOP-SECRET-VALUE");
    expect(JSON.parse(entry.details!).changed).toEqual(expect.arrayContaining(["secret", "minDeposit"]));
  });
});
