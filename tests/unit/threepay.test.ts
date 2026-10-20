import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 3Pay client against the Merchant Integration Guide v1.1, with config and network faked.

const config = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/db", () => ({
  prisma: { threePayConfig: { findUnique: vi.fn(async () => config.current) } },
}));

import {
  classifyPayout,
  createInvoice,
  createPayout,
  depositFromRecord,
  findDeposit,
  findRecentPayout,
  getPayout,
  isTrc20Address,
  threePayEnvFields,
  verifyWebhookSignature,
  checkConnection,
} from "@/lib/threepay";

const CFG = { id: "threepay", baseUrl: "https://pay.example/api/v1/", apiKey: "mk_test", apiSecret: "sk_test", webhookSecret: "whsec", enabled: true, minDeposit: 10 };
const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  config.current = { ...CFG };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isTrc20Address", () => {
  it.each(["TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"])("accepts %s", (a) => expect(isTrc20Address(a)).toBe(true));
  it.each([
    "0xdAC17F958D2ee523a2206206994597C13D831ec7", // ERC20
    "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLS", // too short
    "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE1", // too long
    "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLS0", // 0 is not base58
    "AQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", // must start with T
    "",
  ])("rejects %s", (a) => expect(isTrc20Address(a)).toBe(false));
});

describe("verifyWebhookSignature", () => {
  const body = '{"type":"deposit","status":"confirmed","amount":100}';
  const sig = (b: string, s = "whsec") => `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;

  it("accepts the HMAC-SHA256 of the raw body", () => expect(verifyWebhookSignature(body, sig(body), "whsec")).toBe(true));
  it("accepts an uppercase hex digest", () => expect(verifyWebhookSignature(body, sig(body).toUpperCase().replace("SHA256", "sha256"), "whsec")).toBe(true));
  it("rejects a tampered body", () => expect(verifyWebhookSignature(body.replace("100", "1000"), sig(body), "whsec")).toBe(false));
  it("rejects re-serialised JSON (whitespace changes the HMAC)", () =>
    expect(verifyWebhookSignature(JSON.stringify(JSON.parse(body), null, 2), sig(body), "whsec")).toBe(false));
  it("rejects the wrong secret", () => expect(verifyWebhookSignature(body, sig(body, "other"), "whsec")).toBe(false));
  it.each([null, "", "sha256=", "md5=abcd", "sha256=zz", "sha256=abcd"])("rejects malformed header %j", (h) =>
    expect(verifyWebhookSignature(body, h as string | null, "whsec")).toBe(false));
});

describe("createInvoice", () => {
  it("sends amount, currencyType and URLs as query params with the auth headers", async () => {
    reply(200, { success: true, data: { invoiceNo: "INV-1", paymentUrl: "https://pay.example/checkout/x", walletAddress: "TRyg", amount: 100, expiresAt: "2026-10-21T10:00:00Z" } });
    const inv = await createInvoice({ amount: 100, referenceId: "NEXQ-1", description: "d", webhookUrl: "https://app/api/webhooks/3pay", callbackUrl: "https://app/deposit/return?tx=t1" });
    expect(inv).toMatchObject({ invoiceNo: "INV-1", paymentUrl: "https://pay.example/checkout/x" });

    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.origin + u.pathname).toBe("https://pay.example/api/v1/transaction/create");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      amount: "100.00",
      currencyType: "USDT-TRC20",
      webhookUrl: "https://app/api/webhooks/3pay",
      callbackUrl: "https://app/deposit/return?tx=t1",
    });
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ apikey: "mk_test", "x-api-secret": "sk_test", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ referenceId: "NEXQ-1", description: "d" });
  });

  it.each([
    [401, { success: false, message: "Invalid API credentials" }],
    [403, { success: false, message: "Requesting server/platform IP not whitelisted" }],
    [200, { success: true, data: {} }],
  ])("throws on HTTP %s / incomplete data", async (status, body) => {
    reply(status, body);
    await expect(createInvoice({ amount: 5, referenceId: "r", description: "d", webhookUrl: "w", callbackUrl: "c" })).rejects.toThrow();
  });

  it("refuses to call 3Pay without credentials", async () => {
    config.current = { ...CFG, apiSecret: null };
    await expect(createInvoice({ amount: 5, referenceId: "r", description: "d", webhookUrl: "w", callbackUrl: "c" })).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deposit status", () => {
  it("prefers depositedAmount (what 3Pay credited us), then netAmount", () => {
    expect(depositFromRecord({ status: "CONFIRMED", amount: 100, netAmount: 98, depositedAmount: 98, fee: 2 })).toMatchObject({ status: "confirmed", amount: 100, creditedAmount: 98, fee: 2 });
    expect(depositFromRecord({ status: "confirmed", amount: 100, netAmount: 98 }).creditedAmount).toBe(98);
    // merchant pays the fee: the customer's full amount is credited
    expect(depositFromRecord({ status: "confirmed", amount: 100, netAmount: 98, depositedAmount: 100 }).creditedAmount).toBe(100);
  });

  it("finds the exact invoice in the list search", async () => {
    reply(200, { success: true, data: [{ invoiceNo: "INV-10", status: "expired" }, { invoiceNo: "INV-1", status: "confirmed", amount: 50, depositedAmount: 49 }] });
    expect(await findDeposit("INV-1")).toMatchObject({ status: "confirmed", creditedAmount: 49 });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("search")).toBe("INV-1");
  });

  it("reports not_found rather than guessing", async () => {
    reply(200, { success: true, data: [{ invoiceNo: "INV-12", status: "confirmed" }] });
    expect((await findDeposit("INV-1")).status).toBe("not_found");
  });
});

describe("classifyPayout — the double-payment guard", () => {
  it("200 completed → completed with hash, fee and net", () =>
    expect(classifyPayout({ httpStatus: 200, body: { success: true, data: { withdrawalId: "w1", status: "completed", fee: 2, netAmount: 498, transactionHash: "h1" } } })).toEqual({
      kind: "completed", id: "w1", txHash: "h1", fee: 2, net: 498,
    }));

  it("202 executing → in flight (never retry)", () =>
    expect(classifyPayout({ httpStatus: 202, body: { success: true, data: { withdrawal: { _id: "w2", status: "executing" } } } })).toEqual({ kind: "in_flight", id: "w2", status: "executing" }));

  it("201 pending (manual approval) → in flight", () =>
    expect(classifyPayout({ httpStatus: 201, body: { success: true, data: { withdrawal: { id: "w3", status: "pending" } } } })).toEqual({ kind: "in_flight", id: "w3", status: "pending" }));

  it.each([400, 401, 403, 409, 429])("HTTP %s → rejected before broadcast (safe to retry)", (status) =>
    expect(classifyPayout({ httpStatus: status, body: { success: false, message: "Insufficient balance" } }).kind).toBe("rejected"));

  it.each([500, 502, 503])("HTTP %s → unknown (must check before retrying)", (status) =>
    expect(classifyPayout({ httpStatus: status, body: { success: false, message: "Blockchain service unavailable" } }).kind).toBe("unknown"));

  it("non-JSON 5xx → unknown", () => expect(classifyPayout({ httpStatus: 504, body: null }).kind).toBe("unknown"));

  it("success without an id → unknown, not completed", () =>
    expect(classifyPayout({ httpStatus: 200, body: { success: true, data: { status: "completed" } } }).kind).toBe("unknown"));
});

describe("createPayout", () => {
  it("sends amount, wallet and TRC20 in the body", async () => {
    reply(202, { success: true, data: { withdrawal: { _id: "w9", status: "executing" } } });
    expect(await createPayout({ amount: 50, walletAddress: " TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE " })).toEqual({ kind: "in_flight", id: "w9", status: "executing" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://pay.example/api/v1/withdrawal-request");
    expect(JSON.parse(init.body)).toEqual({ amount: 50, walletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", currencyType: "USDT-TRC20" });
  });

  it("a network error / timeout is UNKNOWN (the request may have gone through)", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    expect(await createPayout({ amount: 50, walletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE" })).toMatchObject({ kind: "unknown", message: expect.stringMatching(/timeout/) });
  });

  it("missing credentials is REJECTED (nothing was sent)", async () => {
    config.current = { ...CFG, apiKey: null };
    expect((await createPayout({ amount: 50, walletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE" })).kind).toBe("rejected");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("payout lookups", () => {
  it("getPayout reads verify?type=withdrawal; 404 → null", async () => {
    reply(200, { success: true, data: { status: "completed", transactionHash: "h", fee: 2, netAmount: 48 } });
    expect(await getPayout("w1")).toEqual({ status: "completed", txHash: "h", fee: 2, net: 48 });
    expect(Object.fromEntries(new URL(String(fetchMock.mock.calls[0][0])).searchParams)).toEqual({ transactionId: "w1", type: "withdrawal" });
    reply(404, { success: false, message: "Not found" });
    expect(await getPayout("nope")).toBeNull();
  });

  it("findRecentPayout matches wallet + amount created after the attempt", async () => {
    const since = new Date("2026-10-21T10:00:00Z");
    const W = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
    const data = [
      { _id: "old", walletAddress: W, amount: 50, status: "completed", createdAt: "2026-10-20T10:00:00Z" }, // before the attempt
      { _id: "other", walletAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", amount: 50, createdAt: "2026-10-21T10:00:30Z" },
      { _id: "amt", walletAddress: W, amount: 51, createdAt: "2026-10-21T10:00:30Z" },
      { _id: "hit", walletAddress: W, amount: 50, status: "executing", createdAt: "2026-10-21T10:00:30Z" },
    ];
    reply(200, { success: true, data });
    expect(await findRecentPayout(W, 50, since)).toMatchObject({ id: "hit", status: "executing" });
    reply(200, { success: true, data: data.slice(0, 3) });
    expect(await findRecentPayout(W, 50, since)).toBeNull();
  });
});

describe("config", () => {
  it("environment overrides Settings; blank env is ignored", async () => {
    vi.stubEnv("THREEPAY_API_SECRET", "sk_env");
    vi.stubEnv("THREEPAY_API_KEY", "  ");
    reply(200, { success: true, data: { totalAmt: 80342.55, autoWithdraw: true } });
    expect(await checkConnection()).toEqual({ ok: true, detail: "balance 80342.55 USDT · payouts auto-execute" });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ apikey: "mk_test", "x-api-secret": "sk_env" });
    expect(threePayEnvFields()).toEqual(["apiSecret"]);
  });

  it("connection test reports the IP-whitelist failure clearly", async () => {
    reply(403, { success: false, message: "Requesting server/platform IP not whitelisted" });
    expect(await checkConnection()).toEqual({ ok: false, detail: "HTTP 403: Requesting server/platform IP not whitelisted" });
  });
});
