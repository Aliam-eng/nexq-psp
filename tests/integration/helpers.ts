import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Integration tests need a throwaway Postgres. They are skipped unless
// TEST_DATABASE_URL is set, and refuse any database whose name lacks "test"
// so they can never wipe a real one. See README → Tests.
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || "";
export const hasTestDb = !!TEST_DATABASE_URL;

export function assertSafeTestDb(url: string) {
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against "${dbName}" — the database name must contain "test".`);
  }
}

export function prismaCli(args: string, url: string, input?: string) {
  return execSync(`npx prisma ${args}`, {
    env: { ...process.env, DATABASE_URL: url },
    input,
    stdio: input === undefined ? "pipe" : ["pipe", "pipe", "pipe"],
  }).toString();
}

// Drop and re-create the public schema from the committed migrations.
export function resetDatabase(url: string) {
  assertSafeTestDb(url);
  prismaCli("migrate reset --force --skip-seed --skip-generate", url);
}

export function withSchema(url: string, schema: string) {
  const u = new URL(url);
  u.searchParams.set("schema", schema);
  return u.toString();
}

// ---- Mock Whish Pay server (documented envelope + endpoints) -------------
export type MockWhish = {
  baseUrl: string;
  calls: { method: string; path: string; query: string; headers: Record<string, any>; body: any }[];
  collect: Map<string, string>; // externalId -> collectStatus
  next: { create?: object; status?: object }; // one-shot overrides
  close: () => Promise<void>;
};

export const WHISH_CREDS = {
  channel: "CH1",
  secret: "S3CRET",
  websiteUrl: "https://nexq.example",
  userAgent: "nexQDeposit/1.0 (https://nexq.example; ops@nexq.example)",
};

const ok = (data: unknown) => ({ status: true, code: null, dialog: null, extra: null, data });

export async function startMockWhish(): Promise<MockWhish> {
  const state = { calls: [], collect: new Map(), next: {} } as Pick<MockWhish, "calls" | "collect" | "next">;

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const [path, query = ""] = (req.url || "").split("?");
      const body = raw ? JSON.parse(raw) : null;
      state.calls.push({ method: req.method || "", path, query, headers: req.headers, body });
      const send = (o: unknown) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(o));
      };

      const h = req.headers;
      if (
        h.channel !== WHISH_CREDS.channel ||
        h.secret !== WHISH_CREDS.secret ||
        h.websiteurl !== WHISH_CREDS.websiteUrl ||
        h["user-agent"] !== WHISH_CREDS.userAgent
      ) {
        return send({ status: false, code: "request.invalid", dialog: { message: "invalid headers" }, data: null });
      }

      if (req.method === "POST" && path === "/payment/whish") {
        if (state.next.create) {
          const o = state.next.create;
          state.next.create = undefined;
          return send(o);
        }
        if (/localhost|127\.0\.0\.1/.test(body.successCallbackUrl)) {
          res.writeHead(403, { "Content-Type": "text/html" });
          return res.end("<html>Forbidden</html>");
        }
        state.collect.set(body.externalId, "pending");
        return send(ok({ collectUrl: `https://whish.money/pay/${body.externalId.slice(0, 7)}` }));
      }
      if (req.method === "POST" && path === "/payment/collect/status") {
        if (state.next.status) {
          const o = state.next.status;
          state.next.status = undefined;
          return send(o);
        }
        const s = state.collect.get(body.externalId);
        if (!s) return send({ status: false, code: "external_id.not_exists", dialog: null, data: null });
        return send(ok({ collectStatus: s, payerPhoneNumber: "96170123456" }));
      }
      if (req.method === "GET" && path === "/payment/account/balance") return send(ok({ balance: 10439 }));
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    ...state,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  } as MockWhish;
}

// ---- Mock 3Pay server (Merchant Integration Guide v1.1) -------------------
export const THREEPAY_CREDS = { apiKey: "mk_test_123", apiSecret: "sk_test_456", webhookSecret: "whsec_789" };

export type MockThreePay = {
  baseUrl: string;
  calls: { method: string; path: string; query: Record<string, string>; body: any }[];
  invoices: Map<string, { invoiceNo: string; referenceId: string; amount: number; status: string; depositedAmount?: number; fee?: number }>;
  payouts: { _id: string; walletAddress: string; amount: number; status: string; createdAt: string; transactionHash?: string }[];
  next: { payout?: { status: number; body: any } }; // one-shot override for POST /withdrawal-request
  payoutMode: "completed" | "executing";
  close: () => Promise<void>;
};

export async function startMockThreePay(): Promise<MockThreePay> {
  const state = {
    calls: [] as MockThreePay["calls"],
    invoices: new Map() as MockThreePay["invoices"],
    payouts: [] as MockThreePay["payouts"],
    next: {} as MockThreePay["next"],
    payoutMode: "completed" as MockThreePay["payoutMode"],
  };
  let seq = 0;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const u = new URL(req.url || "/", "http://x");
      const path = u.pathname.replace(/^\/api\/v1/, "");
      const query = Object.fromEntries(u.searchParams);
      const body = raw ? JSON.parse(raw) : null;
      state.calls.push({ method: req.method || "", path, query, body });
      const send = (status: number, o: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(o));
      };
      if (req.headers.apikey !== THREEPAY_CREDS.apiKey || req.headers["x-api-secret"] !== THREEPAY_CREDS.apiSecret) {
        return send(401, { success: false, message: "Invalid API credentials" });
      }
      if (req.method === "POST" && path === "/transaction/create") {
        const invoiceNo = `INV-${Date.now()}-${++seq}`;
        state.invoices.set(invoiceNo, { invoiceNo, referenceId: body?.referenceId, amount: Number(query.amount), status: "initiated" });
        return send(200, {
          success: true,
          data: { invoiceNo, paymentUrl: `https://pay.mock/checkout/${seq}`, walletAddress: "TRygAGEkC4rF6wnyweM91vtcsFdnAQxWjf", amount: Number(query.amount), currencyType: query.currencyType },
        });
      }
      if (req.method === "GET" && path === "/transaction/list") {
        const data = [...state.invoices.values()]
          .filter((i) => !query.search || i.invoiceNo.includes(query.search) || i.referenceId === query.search)
          .map((i) => ({ invoiceNo: i.invoiceNo, clientReference: i.referenceId, amount: i.amount, fee: i.fee ?? 0, netAmount: i.depositedAmount ?? i.amount, depositedAmount: i.depositedAmount ?? i.amount, status: i.status }));
        return send(200, { success: true, data, pagination: { total: data.length, page: 1, limit: 10, totalPages: 1 } });
      }
      if (req.method === "POST" && path === "/withdrawal-request") {
        if (state.next.payout) {
          const o = state.next.payout;
          state.next.payout = undefined;
          return send(o.status, o.body);
        }
        const _id = `wd_${++seq}`;
        const rec = { _id, walletAddress: body.walletAddress, amount: body.amount, status: state.payoutMode, createdAt: new Date().toISOString(), transactionHash: state.payoutMode === "completed" ? `hash_${seq}` : undefined };
        state.payouts.push(rec);
        if (state.payoutMode === "completed") {
          return send(200, { success: true, data: { withdrawalId: _id, status: "completed", amount: body.amount, fee: 2, netAmount: body.amount - 2, transactionHash: rec.transactionHash, walletAddress: body.walletAddress, currencyType: body.currencyType } });
        }
        return send(202, { success: true, message: "Withdrawal submitted, awaiting blockchain confirmation", data: { withdrawal: { _id, status: "executing" } } });
      }
      if (req.method === "GET" && path === "/transaction/verify" && query.type === "withdrawal") {
        const p = state.payouts.find((x) => x._id === query.transactionId);
        if (!p) return send(404, { success: false, message: "Not found" });
        return send(200, { success: true, data: { ...p, fee: 2, netAmount: p.amount - 2 } });
      }
      if (req.method === "GET" && path === "/withdrawal-requests") {
        return send(200, { success: true, data: [...state.payouts].reverse(), pagination: { total: state.payouts.length, page: 1, limit: 100, totalPages: 1 } });
      }
      if (req.method === "GET" && path === "/getMerchantDetails") {
        return send(200, { success: true, data: { _id: "m1", totalAmt: 80342.55, pendingAmt: 10, autoWithdraw: true } });
      }
      send(404, { success: false, message: "Not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  const api = { ...state, baseUrl: `http://127.0.0.1:${port}/api/v1`, close: () => new Promise<void>((r) => server.close(() => r())) };
  // keep payoutMode/next live-bound to the server's state
  Object.defineProperty(api, "payoutMode", { get: () => state.payoutMode, set: (v) => (state.payoutMode = v) });
  Object.defineProperty(api, "next", { get: () => state.next });
  return api as MockThreePay;
}
