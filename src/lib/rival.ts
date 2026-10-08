import { prisma } from "./db";

// Adapter for Rival Payments / Whish Pay.
// Contract (from docs):
//   Base:   {baseUrl}            e.g. https://staging.portal.rivalpayments.com/v1
//   Auth:   Authorization: Bearer tsk_<company-key>
//   Create: POST {createPaymentPath}  -> data.collectUrl + data.externalId
//   Status: GET  {statusPath (with {id})} -> data.status + data.transactionId
//   Health: GET  {healthPath}  (no key)
// Every response is wrapped: { success, statusCode, data } | { success, error }

export type RivalStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";

export type RivalPayment = {
  externalId: string;
  status: RivalStatus;
  amount: string;
  currency: string;
  invoice: string;
  collectUrl: string;
  transactionId: string | null;
  paidAt: string | null;
  createdAt: string;
};

export class RivalError extends Error {
  code: string;
  statusCode: number;
  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function getConfig() {
  const cfg = await prisma.providerConfig.findUnique({ where: { id: "rival" } });
  if (!cfg) throw new RivalError("NOT_CONFIGURED", "Rival provider is not configured", 500);
  return cfg;
}

function join(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function unwrap<T>(res: Response): Promise<T> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new RivalError("BAD_RESPONSE", `Non-JSON response (HTTP ${res.status})`, res.status);
  }
  if (body && body.success === false) {
    const err = body.error || {};
    throw new RivalError(err.code || "ERROR", err.message || "Request failed", body.statusCode || res.status);
  }
  if (!res.ok) {
    throw new RivalError("HTTP_ERROR", `HTTP ${res.status}`, res.status);
  }
  return (body?.data ?? body) as T;
}

export type CreatePaymentInput = {
  amount: number;
  currency: string;
  invoice: string;
  idempotencyKey?: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
};

export async function createPayment(input: CreatePaymentInput): Promise<RivalPayment> {
  const cfg = await getConfig();
  if (!cfg.enabled) throw new RivalError("DISABLED", "Rival provider is disabled", 503);
  if (!cfg.apiKey || !cfg.baseUrl) throw new RivalError("NOT_CONFIGURED", "Missing API key or base URL", 500);

  const url = join(cfg.baseUrl, cfg.createPaymentPath || "/integrations/whish/payments");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amount.toFixed(2), // decimal string per docs
      currency: input.currency,
      invoice: input.invoice,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.successRedirectUrl ? { successRedirectUrl: input.successRedirectUrl } : {}),
      ...(input.failureRedirectUrl ? { failureRedirectUrl: input.failureRedirectUrl } : {}),
    }),
    cache: "no-store",
  });
  return unwrap<RivalPayment>(res);
}

export async function getPayment(externalId: string): Promise<RivalPayment> {
  const cfg = await getConfig();
  if (!cfg.apiKey || !cfg.baseUrl) throw new RivalError("NOT_CONFIGURED", "Missing API key or base URL", 500);
  const path = (cfg.statusPath || "/integrations/whish/payments/{id}").replace("{id}", encodeURIComponent(externalId));
  const res = await fetch(join(cfg.baseUrl, path), {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    cache: "no-store",
  });
  return unwrap<RivalPayment>(res);
}

// Health check — no key needed. Returns true if reachable.
export async function checkHealth(): Promise<{ ok: boolean; detail: string }> {
  const cfg = await getConfig();
  if (!cfg.baseUrl) return { ok: false, detail: "No base URL set" };
  try {
    const res = await fetch(join(cfg.baseUrl, cfg.healthPath || "/health"), { cache: "no-store" });
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message || "unreachable" };
  }
}
