import { prisma } from "./db";
import { webapiTest, webapiDeposit } from "./mt5-webapi";

// MT5 integration via the MetaQuotes WebAPI (cross-platform, runs in-process —
// no separate gateway). Connection details come from Settings (Mt5Config).

export type Mt5DepositInput = {
  login: string;
  amount: number;
  currency: string;
  group?: string | null;
  comment: string;
  reference: string;
};

export type Mt5DepositResult =
  | { ok: true; dealId: string; message?: string }
  | { ok: false; message: string };

async function getConfig() {
  const cfg = await prisma.mt5Config.findUnique({ where: { id: "mt5" } });
  if (!cfg) throw new Error("MT5 is not configured");
  return cfg;
}

export async function mt5Deposit(input: Mt5DepositInput): Promise<Mt5DepositResult> {
  const cfg = await getConfig();
  if (!cfg.enabled) return { ok: false, message: "MT5 integration is disabled" };
  if (!cfg.mt5Server || !cfg.mt5Login || !cfg.mt5Password)
    return { ok: false, message: "MT5 WebAPI connection (host/login/password) not configured" };

  const result = await webapiDeposit({
    server: cfg.mt5Server,
    login: cfg.mt5Login,
    password: cfg.mt5Password,
    cryptMethod: cfg.cryptMethod,
    clientLogin: input.login,
    amount: input.amount,
    comment: input.comment,
    reference: input.reference,
  });
  if (result.ok) return { ok: true, dealId: result.dealId, message: "balance operation accepted" };
  return { ok: false, message: result.message };
}

// "Test connection" from Settings — performs the WebAPI auth handshake.
export async function mt5TestConnect(): Promise<{ ok: boolean; detail: string }> {
  const cfg = await getConfig();
  if (!cfg.mt5Server || !cfg.mt5Login || !cfg.mt5Password)
    return { ok: false, detail: "Set WebAPI host:port, login and password first" };
  return webapiTest({
    server: cfg.mt5Server,
    login: cfg.mt5Login,
    password: cfg.mt5Password,
    cryptMethod: cfg.cryptMethod,
  });
}
