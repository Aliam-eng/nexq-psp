import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { createPayment, RivalError } from "@/lib/rival";
import { computeFee, computeTotal } from "@/lib/fees";

// Public (no-login) deposit creation. The client enters their MT5 account
// number and amount; we create a Whish Pay link and return it.
const schema = z.object({
  mt5Login: z.string().trim().min(1).max(32).regex(/^[0-9]+$/, "MT5 account must be numeric"),
  amount: z.coerce.number().positive().max(1_000_000),
  currency: z.string().trim().min(3).max(8).default("USD"),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  name: z.string().trim().max(120).optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const { mt5Login, amount, currency, email, name } = parsed.data;

  // Enforce the admin-configured minimum deposit server-side.
  const cfg = await prisma.providerConfig.findUnique({ where: { id: "rival" }, select: { minDeposit: true } });
  const minDeposit = cfg?.minDeposit ?? 0;
  if (minDeposit > 0 && amount < minDeposit) {
    return NextResponse.json(
      { error: `Minimum deposit is ${minDeposit.toFixed(2)} ${currency.toUpperCase()}` },
      { status: 400 }
    );
  }

  // Fee is added on top: client pays (amount + fee); MT5 is credited `amount`.
  const fee = computeFee(amount);
  const total = computeTotal(amount);

  const reference = `NEXQ-${randomUUID().slice(0, 8).toUpperCase()}`;
  const base = process.env.APP_BASE_URL || "http://localhost:3000";

  // Always record the transaction first for audit.
  const tx = await prisma.transaction.create({
    data: {
      mt5Login,
      clientEmail: email,
      clientName: name,
      amount,
      fee,
      currency: currency.toUpperCase(),
      reference,
      status: "PENDING",
    },
  });

  try {
    const payment = await createPayment({
      amount: total, // client pays deposit + fee
      currency: currency.toUpperCase(),
      invoice: `${reference} • MT5 ${mt5Login}`,
      idempotencyKey: reference,
      successRedirectUrl: `${base}/deposit/return?tx=${tx.id}`,
      failureRedirectUrl: `${base}/deposit/return?tx=${tx.id}`,
    });

    const updated = await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "LINK_GENERATED",
        rivalPaymentId: payment.externalId,
        whishpayUrl: payment.collectUrl,
        providerPayload: JSON.stringify(payment),
      },
    });

    return NextResponse.json({
      ok: true,
      transactionId: updated.id,
      reference,
      collectUrl: payment.collectUrl,
    });
  } catch (e: any) {
    // Store the detailed reason for admins, but don't leak provider internals
    // (keys, config state) to anonymous callers on this public endpoint.
    const detail = e instanceof RivalError ? `${e.code}: ${e.message}` : e?.message || "Payment creation failed";
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: "FAILED", errorMessage: detail },
    });
    const clientMessage =
      e instanceof RivalError && (e.code === "VALIDATION_ERROR" || e.code === "NO_COMMISSION_RULE")
        ? e.message // safe, user-actionable (e.g. amount issues)
        : "Payment service is temporarily unavailable. Please try again later.";
    return NextResponse.json({ error: clientMessage }, { status: 502 });
  }
}
