import { prisma } from "./db";

// Direct Whish Pay client (Whish Money Developers — Whish Pay v1.4.4).
//   Base:    {baseUrl}  sandbox https://partner.api.sbx.whish.money/itel-service/api
//                       production https://api.whish.money/itel-service/api
//   Auth:    headers channel, secret, websiteUrl, User-Agent (all issued by Whish)
//   Create:  POST /payment/whish            -> data.collectUrl
//   Status:  POST /payment/collect/status   -> data.collectStatus
//   Balance: GET  /payment/account/balance?currency=USD (used as the connection test)
// Every response is HTTP 200 with an envelope { status, code, dialog, data }:
//   status true                -> succeeded, read data
//   status false + code "500"  -> PENDING: outcome unknown, reconcile — never treat as failed
//   status false + other code  -> failed, branch on code

export type WhishCollectStatus = "pending" | "success" | "failed" | "refunded" | "unknown";

export class WhishError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// The call was not resolved either way (code 500). Safe to retry with the same externalId.
export class WhishPendingError extends WhishError {
  constructor(message = "Whish did not return an outcome (pending)") {
    super("500", message);
  }
}

export const WHISH_SANDBOX_URL = "https://partner.api.sbx.whish.money/itel-service/api";
export const WHISH_PRODUCTION_URL = "https://api.whish.money/itel-service/api";

// Credentials can come from the server environment (.env — never committed) or from
// Admin → Settings. Environment values win, so production secrets can live outside the DB.
// The on/off switch and minimum deposit always stay in Settings.
const ENV_KEYS = {
  baseUrl: "WHISH_BASE_URL",
  channel: "WHISH_CHANNEL",
  secret: "WHISH_SECRET",
  websiteUrl: "WHISH_WEBSITE_URL",
  userAgent: "WHISH_USER_AGENT",
} as const;
type CredField = keyof typeof ENV_KEYS;

function fromEnv(field: CredField): string | undefined {
  const v = process.env[ENV_KEYS[field]]?.trim();
  return v ? v : undefined;
}

// Which credential fields are pinned by the environment (shown read-only in Settings).
export function whishEnvFields(): CredField[] {
  return (Object.keys(ENV_KEYS) as CredField[]).filter((f) => fromEnv(f) !== undefined);
}

export async function getWhishCredentials() {
  const row = await prisma.providerConfig.findUnique({ where: { id: "whish" } });
  const pick = (f: CredField) => fromEnv(f) ?? (row?.[f] || undefined);
  return {
    baseUrl: pick("baseUrl"),
    channel: pick("channel"),
    secret: pick("secret"),
    websiteUrl: pick("websiteUrl"),
    userAgent: pick("userAgent"),
    enabled: row?.enabled ?? false,
  };
}

async function getConfig(): Promise<Record<CredField, string>> {
  const { baseUrl, channel, secret, websiteUrl, userAgent } = await getWhishCredentials();
  if (!baseUrl || !channel || !secret || !websiteUrl || !userAgent) {
    throw new WhishError("NOT_CONFIGURED", "Missing Whish base URL, channel, secret, website URL or User-Agent");
  }
  return { baseUrl, channel, secret, websiteUrl, userAgent };
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const cfg = await getConfig();
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const headers: Record<string, string> = {
    channel: cfg.channel,
    secret: cfg.secret,
    websiteUrl: cfg.websiteUrl,
    "User-Agent": cfg.userAgent,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  let json: any;
  try {
    json = await res.json();
  } catch {
    // Whish answers non-public callback/redirect URLs with an HTML 403, not the envelope.
    const hint = res.status === 403 ? " — callback/redirect URLs must be public (check APP_BASE_URL)" : "";
    throw new WhishError("BAD_RESPONSE", `Non-JSON response (HTTP ${res.status})${hint}`);
  }

  if (json?.status === true) return json.data as T;
  const code = json?.code == null ? "" : String(json.code);
  const dialog = json?.dialog;
  const message = (dialog && (dialog.message || dialog.title)) || code || `HTTP ${res.status}`;
  if (code === "500") throw new WhishPendingError();
  throw new WhishError(code || "UNKNOWN", String(message));
}

// Whish wants the amount as a string: USD up to 2 decimals (min 1.00), LBP whole numbers (min 1000).
export function formatAmount(amount: number, currency: string): string {
  return currency.toUpperCase() === "LBP" ? String(Math.round(amount)) : amount.toFixed(2);
}

export type CreatePaymentInput = {
  amount: number;
  currency: string;
  invoice: string;
  externalId: string;
  successCallbackUrl: string;
  failureCallbackUrl: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
};

export async function createPayment(input: CreatePaymentInput): Promise<{ collectUrl: string }> {
  const { enabled } = await getWhishCredentials();
  if (!enabled) throw new WhishError("DISABLED", "Whish Pay is disabled");

  const data = await call<{ collectUrl?: string }>("POST", "/payment/whish", {
    ...input,
    amount: formatAmount(input.amount, input.currency),
    currency: input.currency.toUpperCase(),
  });
  if (!data?.collectUrl) throw new WhishError("BAD_RESPONSE", "Whish returned no collectUrl");
  return { collectUrl: data.collectUrl };
}

export async function getCollectStatus(
  externalId: string,
  currency: string
): Promise<{ collectStatus: WhishCollectStatus; payerPhoneNumber: string | null }> {
  const data = await call<{ collectStatus?: string; payerPhoneNumber?: string }>("POST", "/payment/collect/status", {
    currency: currency.toUpperCase(),
    externalId,
  });
  const s = String(data?.collectStatus || "unknown").toLowerCase();
  const known: WhishCollectStatus[] = ["pending", "success", "failed", "refunded", "unknown"];
  return {
    collectStatus: (known as string[]).includes(s) ? (s as WhishCollectStatus) : "unknown",
    payerPhoneNumber: data?.payerPhoneNumber ?? null,
  };
}

// Authenticated connection test: reads the account balance.
export async function checkConnection(currency = "USD"): Promise<{ ok: boolean; detail: string }> {
  try {
    const data = await call<{ balance?: number }>("GET", `/payment/account/balance?currency=${currency}`);
    return { ok: true, detail: `balance ${currency} ${Number(data?.balance ?? 0).toFixed(2)}` };
  } catch (e: any) {
    return { ok: false, detail: e instanceof WhishError ? `${e.code}: ${e.message}` : e?.message || "unreachable" };
  }
}
