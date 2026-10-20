import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { createPayment, WhishError, WhishPendingError } from "@/lib/whish";
import { computeFee, computeTotal } from "@/lib/fees";
import { createInvoice, getThreePayConfig, ThreePayError } from "@/lib/threepay";

// Public (no-login) deposit creation. The client enters their MT5 account
// number and amount; we create a Whish Pay link (direct Whish API) and return it.
const schema = z.object({
  mt5Login: z.string().trim().min(1).max(32).regex(/^[0-9]+$/, "MT5 account must be numeric"),
  amount: z.coerce.number().positive().max(1_000_000),
  currency: z.string().trim().min(3).max(8).default("USD"),
  email: z.string().email().optional().or(z.literal("")).transform((v) => v || undefined),
  name: z.string().trim().max(120).optional(),
  method: z.enum(["WHISH", "USDT_TRC20"]).default("WHISH"),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }
  const { mt5Login, amount, currency, email, name, method } = parsed.data;
  if (method === "USDT_TRC20") return createUsdtDeposit({ mt5Login, amount, email, name });

  // Enforce the admin-configured minimum deposit server-side.
  const cfg = await prisma.providerConfig.findUnique({ where: { id: "whish" }, select: { minDeposit: true } });
  // Whish's own floor: 1.00 USD / 1000 LBP.
  const whishMin = currency.toUpperCase() === "LBP" ? 1000 : 1;
  const minDeposit = Math.max(cfg?.minDeposit ?? 0, whishMin);
  if (amount < minDeposit) {
    return NextResponse.json(
      { error: `Minimum deposit is ${minDeposit.toFixed(2)} ${currency.toUpperCase()}` },
      { status: 400 }
    );
  }

  // Fee is added on top: client pays (amount + fee); MT5 is credited `amount`.
  const fee = computeFee(amount);
  const total = computeTotal(amount);

  const reference = `NEXQ-${randomUUID().slice(0, 8).toUpperCase()}`;
  const externalId = randomUUID(); // Whish transaction reference — unique per payment
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

  // Always record the transaction (with its externalId) first, so any outcome can be reconciled.
  const tx = await prisma.transaction.create({
    data: {
      mt5Login,
      clientEmail: email,
      clientName: name,
      amount,
      fee,
      currency: currency.toUpperCase(),
      reference,
      whishExternalId: externalId,
      status: "PENDING",
    },
  });

  // Whish adds no identifiers to callbacks, so we carry our own externalId in the URL.
  const callback = (result: "success" | "failure") =>
    `${base}/api/webhooks/whish?externalId=${externalId}&result=${result}`;
  const returnUrl = `${base}/deposit/return?tx=${tx.id}`;
  const request = {
    amount: total, // client pays deposit + fee
    currency: currency.toUpperCase(),
    invoice: `${reference} - MT5 ${mt5Login}`,
    externalId,
    successCallbackUrl: callback("success"),
    failureCallbackUrl: callback("failure"),
    successRedirectUrl: returnUrl,
    failureRedirectUrl: returnUrl,
  };

  try {
    let payment;
    try {
      payment = await createPayment(request);
    } catch (e) {
      // Outcome unknown: re-sending the same externalId is safe (Whish replays, never double-executes).
      if (!(e instanceof WhishPendingError)) throw e;
      payment = await createPayment(request);
    }

    const updated = await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "LINK_GENERATED",
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
    const detail = e instanceof WhishError ? `${e.code}: ${e.message}` : e?.message || "Payment creation failed";
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { status: "FAILED", errorMessage: detail },
    });
    const clientMessage =
      e instanceof WhishError && (e.code === "fail" || e.code === "currency.not_supported")
        ? e.message // safe, user-actionable (amount / currency issues)
        : "Payment service is temporarily unavailable. Please try again later.";
    return NextResponse.json({ error: clientMessage }, { status: 502 });
  }
}

// USDT (TRC20) via 3Pay: create an invoice and send the client to 3Pay's hosted page.
// The amount MT5 is credited is fixed when 3Pay confirms (what 3Pay credits us, after its fee).
async function createUsdtDeposit(input: { mt5Login: string; amount: number; email?: string; name?: string }) {
  const cfg = await getThreePayConfig();
  if (!cfg.enabled) return NextResponse.json({ error: "USDT deposits are not available right now" }, { status: 400 });
  const minDeposit = Math.max(cfg.minDeposit, 1); // 3Pay's own minimum is 1 USDT
  if (input.amount < minDeposit) {
    return NextResponse.json({ error: `Minimum USDT deposit is ${minDeposit.toFixed(2)} USDT` }, { status: 400 });
  }

  const reference = `NEXQ-${randomUUID().slice(0, 8).toUpperCase()}`;
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const tx = await prisma.transaction.create({
    data: {
      mt5Login: input.mt5Login,
      clientEmail: input.email,
      clientName: input.name,
      amount: input.amount,
      grossAmount: input.amount,
      currency: "USD",
      method: "USDT_TRC20",
      reference,
      status: "PENDING",
    },
  });

  try {
    // No blind retry: 3Pay has no idempotency key, so a repeat call could make a second invoice.
    const invoice = await createInvoice({
      amount: input.amount,
      referenceId: reference,
      description: `nexQ deposit ${reference} - MT5 ${input.mt5Login}`,
      webhookUrl: `${base}/api/webhooks/3pay`,
      callbackUrl: `${base}/deposit/return?tx=${tx.id}`,
    });
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "LINK_GENERATED",
        threepayInvoiceNo: invoice.invoiceNo,
        threepayTxId: invoice.transactionId,
        providerPayload: JSON.stringify(invoice),
      },
    });
    return NextResponse.json({ ok: true, transactionId: tx.id, reference, collectUrl: invoice.paymentUrl });
  } catch (e: any) {
    const detail = e instanceof ThreePayError ? `3Pay: ${e.message}` : e?.message || "Invoice creation failed";
    await prisma.transaction.update({ where: { id: tx.id }, data: { status: "FAILED", errorMessage: detail } });
    return NextResponse.json({ error: "Payment service is temporarily unavailable. Please try again later." }, { status: 502 });
  }
}
