import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

// 3Pay USDT client (Merchant Integration Guide v1.1). TRC20 only for now.
//   Base:     https://pay.3pa-y.com/api/v1
//   Auth:     headers apikey + x-api-secret, from a whitelisted server IP
//   Deposit:  POST /transaction/create?amount=&currencyType=&webhookUrl=&callbackUrl=  -> paymentUrl, invoiceNo
//   Status:   GET  /transaction/list?search=<invoiceNo>     (verify keys on a transactionId we may not have)
//   Payout:   POST /withdrawal-request {amount, walletAddress, currencyType}
//   Payout?:  GET  /transaction/verify?transactionId=<_id>&type=withdrawal
//   Balance:  GET  /getMerchantDetails
//   Webhooks: POST, X-Webhook-Signature: sha256=<hex HMAC-SHA256(webhookSecret, raw body)>
// 3Pay has NO idempotency key: a payout that ends in a 5xx/timeout must be looked up
// before anyone retries it, or the client could be paid twice.

export const CURRENCY = "USDT-TRC20";
export const TRC20_PAYOUT_FEE = 2; // USDT, deducted from the requested amount by 3Pay
export const DEFAULT_BASE_URL = "https://pay.3pa-y.com/api/v1";
const TRC20_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export const isTrc20Address = (s: string) => TRC20_ADDRESS.test(s.trim());

export class ThreePayError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

const ENV = {
  baseUrl: "THREEPAY_BASE_URL",
  apiKey: "THREEPAY_API_KEY",
  apiSecret: "THREEPAY_API_SECRET",
  webhookSecret: "THREEPAY_WEBHOOK_SECRET",
} as const;
type CredField = keyof typeof ENV;
const fromEnv = (f: CredField) => process.env[ENV[f]]?.trim() || undefined;

export function threePayEnvFields(): CredField[] {
  return (Object.keys(ENV) as CredField[]).filter((f) => fromEnv(f) !== undefined);
}

export async function getThreePayConfig() {
  const row = await prisma.threePayConfig.findUnique({ where: { id: "threepay" } });
  const pick = (f: CredField) => fromEnv(f) ?? (row?.[f] || undefined);
  return {
    baseUrl: pick("baseUrl") ?? DEFAULT_BASE_URL,
    apiKey: pick("apiKey"),
    apiSecret: pick("apiSecret"),
    webhookSecret: pick("webhookSecret"),
    enabled: row?.enabled ?? false, // USDT deposits
    withdrawalsEnabled: row?.withdrawalsEnabled ?? false, // USDT payouts
    minDeposit: row?.minDeposit ?? 10,
  };
}

type RawResult = { httpStatus: number; body: any };

async function request(method: "GET" | "POST", path: string, opts: { query?: Record<string, string>; body?: unknown; timeoutMs?: number } = {}): Promise<RawResult> {
  const cfg = await getThreePayConfig();
  if (!cfg.apiKey || !cfg.apiSecret) throw new ThreePayError("3Pay API key/secret not configured");
  const url = new URL(`${cfg.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: { apikey: cfg.apiKey, "x-api-secret": cfg.apiSecret, "Content-Type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON — handled by callers via httpStatus */
  }
  return { httpStatus: res.status, body };
}

const describe = (r: RawResult) =>
  `HTTP ${r.httpStatus}${r.body?.message ? `: ${r.body.message}` : ""}${r.body?.error && r.body.error !== r.body?.message ? ` (${r.body.error})` : ""}`;

// ---------------------------------------------------------------- deposits

export type Invoice = { invoiceNo: string; paymentUrl: string; walletAddress: string | null; transactionId: string | null; expiresAt: string | null };

export async function createInvoice(input: {
  amount: number;
  referenceId: string;
  description: string;
  webhookUrl: string;
  callbackUrl: string;
}): Promise<Invoice> {
  const r = await request("POST", "/transaction/create", {
    // amount + currencyType must be query params (per the guide); context fields go in the body.
    query: {
      amount: input.amount.toFixed(2),
      currencyType: CURRENCY,
      webhookUrl: input.webhookUrl,
      callbackUrl: input.callbackUrl,
    },
    body: { referenceId: input.referenceId, description: input.description },
  });
  const d = r.body?.data;
  if (r.httpStatus >= 300 || !r.body?.success || !d?.invoiceNo || !d?.paymentUrl) throw new ThreePayError(describe(r), r.httpStatus);
  return {
    invoiceNo: String(d.invoiceNo),
    paymentUrl: String(d.paymentUrl),
    walletAddress: d.walletAddress ?? null,
    transactionId: d.transactionId ?? null,
    expiresAt: d.expiresAt ?? null,
  };
}

export type DepositStatus = {
  status: string; // initiated | pending | confirmed | expired | failed | not_found
  amount: number | null; // invoice amount
  creditedAmount: number | null; // depositedAmount (what 3Pay credited us), else netAmount
  fee: number | null;
  transactionId: string | null;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function depositFromRecord(d: any): DepositStatus {
  return {
    status: String(d?.status ?? "unknown").toLowerCase(),
    amount: num(d?.amount),
    creditedAmount: num(d?.depositedAmount) ?? num(d?.netAmount),
    fee: num(d?.fee),
    transactionId: d?.transactionId ? String(d.transactionId) : null,
  };
}

// The list endpoint searches invoiceNo/clientReference; verify needs a transactionId
// the create response doesn't always include — so reconcile from the list record.
export async function findDeposit(invoiceNo: string): Promise<DepositStatus> {
  const r = await request("GET", "/transaction/list", { query: { search: invoiceNo, limit: "10", page: "1" } });
  if (r.httpStatus >= 300 || !r.body?.success) throw new ThreePayError(describe(r), r.httpStatus);
  const rec = (Array.isArray(r.body.data) ? r.body.data : []).find((x: any) => x?.invoiceNo === invoiceNo);
  if (!rec) return { status: "not_found", amount: null, creditedAmount: null, fee: null, transactionId: null };
  return depositFromRecord(rec);
}

// ----------------------------------------------------------------- payouts

export type PayoutResult =
  | { kind: "completed"; id: string; txHash: string | null; fee: number | null; net: number | null }
  | { kind: "in_flight"; id: string; status: string } // executing / pending — never retry, wait for the webhook
  | { kind: "rejected"; message: string } // nothing left 3Pay; safe to retry or refund
  | { kind: "unknown"; message: string }; // 5xx / timeout — look it up before any retry

export function classifyPayout(r: RawResult): PayoutResult {
  const d = r.body?.data;
  const w = d?.withdrawal;
  if (r.body?.success && r.httpStatus < 300) {
    const id = String(d?.withdrawalId ?? w?._id ?? w?.id ?? d?._id ?? "");
    const status = String(d?.status ?? w?.status ?? "").toLowerCase();
    if (!id) return { kind: "unknown", message: `3Pay accepted the payout but returned no id (${describe(r)})` };
    if (status === "completed") return { kind: "completed", id, txHash: d?.transactionHash ?? null, fee: num(d?.fee), net: num(d?.netAmount) };
    if (status === "failed" || status === "rejected") return { kind: "rejected", message: `3Pay reported ${status}` };
    return { kind: "in_flight", id, status: status || "executing" };
  }
  // 4xx are refused before broadcast (bad payload, balance, wallet format, auth, IP, rate limit).
  if (r.httpStatus >= 400 && r.httpStatus < 500) return { kind: "rejected", message: describe(r) };
  return { kind: "unknown", message: describe(r) };
}

export async function createPayout(input: { amount: number; walletAddress: string }): Promise<PayoutResult> {
  let r: RawResult;
  try {
    // 3Pay polls the chain for up to ~40s before answering.
    r = await request("POST", "/withdrawal-request", {
      body: { amount: Number(input.amount.toFixed(2)), walletAddress: input.walletAddress.trim(), currencyType: CURRENCY },
      timeoutMs: 75_000,
    });
  } catch (e: any) {
    if (e instanceof ThreePayError && e.status === 0 && /not configured/.test(e.message)) return { kind: "rejected", message: e.message };
    return { kind: "unknown", message: `no response from 3Pay (${e?.name === "TimeoutError" ? "timeout" : e?.message || e})` };
  }
  return classifyPayout(r);
}

export type PayoutStatus = { status: string; txHash: string | null; fee: number | null; net: number | null };

export function payoutFromRecord(d: any): PayoutStatus {
  return {
    status: String(d?.status ?? "unknown").toLowerCase(),
    txHash: d?.transactionHash ?? d?.blockchainTxHash ?? null,
    fee: num(d?.fee),
    net: num(d?.netAmount),
  };
}

export async function getPayout(id: string): Promise<PayoutStatus | null> {
  const r = await request("GET", "/transaction/verify", { query: { transactionId: id, type: "withdrawal" } });
  if (r.httpStatus === 404) return null;
  if (r.httpStatus >= 300 || !r.body?.success) throw new ThreePayError(describe(r), r.httpStatus);
  return payoutFromRecord(r.body.data);
}

// After an "unknown" outcome: did 3Pay create a payout for this wallet+amount after we tried?
export async function findRecentPayout(walletAddress: string, amount: number, since: Date): Promise<(PayoutStatus & { id: string }) | null> {
  const r = await request("GET", "/withdrawal-requests", { query: { page: "1", limit: "100" } });
  if (r.httpStatus >= 300 || !r.body?.success) throw new ThreePayError(describe(r), r.httpStatus);
  const cutoff = since.getTime() - 2 * 60 * 1000;
  const match = (Array.isArray(r.body.data) ? r.body.data : []).find(
    (w: any) =>
      String(w?.walletAddress ?? "").trim() === walletAddress.trim() &&
      Math.abs(Number(w?.amount) - amount) < 0.005 &&
      new Date(w?.createdAt ?? 0).getTime() >= cutoff
  );
  return match ? { id: String(match._id), ...payoutFromRecord(match) } : null;
}

// ------------------------------------------------------------------- misc

export async function checkConnection(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await request("GET", "/getMerchantDetails");
    if (r.httpStatus >= 300 || !r.body?.success) return { ok: false, detail: describe(r) };
    const d = r.body.data ?? {};
    return {
      ok: true,
      detail: `balance ${Number(d.totalAmt ?? 0).toFixed(2)} USDT · payouts ${d.autoWithdraw ? "auto-execute" : "need 3Pay approval"}`,
    };
  } catch (e: any) {
    return { ok: false, detail: e?.message || "unreachable" };
  }
}

// X-Webhook-Signature: sha256=<hex HMAC-SHA256(webhookSecret, rawBody)>, compared in constant time.
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  const [scheme, received] = (header ?? "").split("=");
  if (scheme !== "sha256" || !received || !/^[0-9a-f]+$/i.test(received)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(received.toLowerCase(), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
