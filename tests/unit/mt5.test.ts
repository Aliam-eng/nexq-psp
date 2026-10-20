import { beforeEach, describe, expect, it, vi } from "vitest";

// The money direction must never be wrong: deposits add, withdrawals subtract
// (with MT5's margin check on), both tagged with the reference for duplicate protection.

const cfg = vi.hoisted(() => ({
  current: {
    id: "mt5",
    enabled: true,
    mt5Server: "mt5.example:443",
    mt5Login: "1000",
    mt5Password: "pw",
    cryptMethod: "NONE",
  } as Record<string, unknown> | null,
}));
vi.mock("@/lib/db", () => ({ prisma: { mt5Config: { findUnique: async () => cfg.current } } }));

const webapi = vi.hoisted(() => ({ webapiDeposit: vi.fn(), webapiTest: vi.fn() }));
vi.mock("@/lib/mt5-webapi", () => webapi);

import { mt5Deposit, mt5Withdraw } from "@/lib/mt5";

const INPUT = { login: "5000123", amount: 150, currency: "USD", comment: "Withdrawal NEXQ-W-1", reference: "NEXQ-W-1" };

beforeEach(() => {
  cfg.current = { id: "mt5", enabled: true, mt5Server: "mt5.example:443", mt5Login: "1000", mt5Password: "pw", cryptMethod: "NONE" };
  webapi.webapiDeposit.mockReset();
  webapi.webapiDeposit.mockResolvedValue({ ok: true, dealId: "D-1" });
});

describe("mt5Withdraw", () => {
  it("sends a NEGATIVE balance operation with the margin check on", async () => {
    expect(await mt5Withdraw(INPUT)).toEqual({ ok: true, dealId: "D-1", message: "withdrawal accepted" });
    expect(webapi.webapiDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ clientLogin: "5000123", amount: -150, checkMargin: true, reference: "NEXQ-W-1", comment: "Withdrawal NEXQ-W-1" })
    );
  });

  it("passes MT5's refusal through", async () => {
    webapi.webapiDeposit.mockResolvedValue({ ok: false, message: "TRADE_BALANCE failed: Not enough money" });
    expect(await mt5Withdraw(INPUT)).toEqual({ ok: false, message: "TRADE_BALANCE failed: Not enough money" });
  });

  it.each([0, -5, NaN])("refuses a non-positive amount (%s) without calling MT5", async (amount) => {
    expect((await mt5Withdraw({ ...INPUT, amount })).ok).toBe(false);
    expect(webapi.webapiDeposit).not.toHaveBeenCalled();
  });

  it("does nothing while MT5 is disabled or not configured", async () => {
    cfg.current = { ...cfg.current!, enabled: false };
    expect(await mt5Withdraw(INPUT)).toMatchObject({ ok: false, message: "MT5 integration is disabled" });
    cfg.current = { ...cfg.current!, enabled: true, mt5Password: null };
    expect((await mt5Withdraw(INPUT)).ok).toBe(false);
    expect(webapi.webapiDeposit).not.toHaveBeenCalled();
  });
});

describe("mt5Deposit (unchanged)", () => {
  it("sends a POSITIVE balance operation with the margin check off", async () => {
    await mt5Deposit({ ...INPUT, comment: "Deposit NEXQ-1", reference: "NEXQ-1" });
    const call = webapi.webapiDeposit.mock.calls[0][0];
    expect(call.amount).toBe(150);
    expect(call.checkMargin).toBeFalsy();
  });
});
