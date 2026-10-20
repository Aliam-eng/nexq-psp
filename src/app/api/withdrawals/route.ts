import { NextResponse } from "next/server";
import { z } from "zod";
import { createWithdrawal } from "@/lib/withdrawals";

// Public (no-login) withdrawal request. Nothing moves until a back-office user
// approves it; approval deducts the amount from the MT5 account (and, for USDT,
// sends the payout through 3Pay).
const schema = z
  .object({
    mt5Login: z.string().trim().min(1).max(32).regex(/^[0-9]+$/, "MT5 account must be numeric"),
    amount: z.coerce.number().positive("Enter a valid amount").max(1_000_000),
    method: z.enum(["WHISH", "USDT_TRC20"]).default("WHISH"),
    phone: z.string().trim().max(32).optional(),
    walletAddress: z.string().trim().max(64).optional(),
  })
  .refine((d) => (d.method === "WHISH" ? !!d.phone && d.phone.length >= 6 : !!d.walletAddress), {
    message: "Enter where we should send the money",
  });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }
  const result = await createWithdrawal(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.code === "OPEN_REQUEST" ? 409 : 400 });
  }
  const w = result.withdrawal;
  return NextResponse.json({ ok: true, reference: w.reference, amount: w.amount, currency: w.currency, method: w.method });
}
