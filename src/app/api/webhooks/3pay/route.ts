import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { confirmThreePayDeposit, reconcileTransaction } from "@/lib/flow";
import { handlePayoutEvent, checkPayout } from "@/lib/withdrawals";
import { depositFromRecord, getThreePayConfig, payoutFromRecord, verifyWebhookSignature } from "@/lib/threepay";

// 3Pay webhook (deposits + payouts). 3Pay sends it to the webhookUrl we pass on
// /transaction/create (it becomes the account default), signed with the merchant
// webhook secret: X-Webhook-Signature: sha256=<HMAC-SHA256(secret, raw body)>.
//
//  • Signature valid      → trust the payload and act on it.
//  • No secret configured → treat it only as a hint: re-check the record through 3Pay's API.
//  • Signature invalid    → 401 (anyone can POST to a public URL).
// Every verified event gets a 200, even if already processed — non-2xx makes 3Pay retry.

export async function POST(req: Request) {
  const raw = await req.text(); // raw body: re-serialising would break the HMAC
  const cfg = await getThreePayConfig();
  const signed = !!cfg.webhookSecret;
  if (signed && !verifyWebhookSignature(raw, req.headers.get("x-webhook-signature"), cfg.webhookSecret!)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const type = String(event?.type ?? "").toLowerCase();

  try {
    if (type === "deposit") {
      const tx = await prisma.transaction.findFirst({
        where: {
          method: "USDT_TRC20",
          OR: [
            ...(event.invoiceNo ? [{ threepayInvoiceNo: String(event.invoiceNo) }] : []),
            ...(event.clientReference ? [{ reference: String(event.clientReference) }] : []),
          ],
        },
      });
      if (!tx) return NextResponse.json({ ok: true, matched: false });
      const status = String(event.status ?? "").toLowerCase();
      const updated =
        signed && status === "confirmed"
          ? await confirmThreePayDeposit(tx.id, depositFromRecord(event), event.blockchainTxHash ?? null)
          : await reconcileTransaction(tx.id); // unsigned or non-final: verify through the API
      return NextResponse.json({ ok: true, matched: true, status: updated?.status });
    }

    if (type === "payout" || type === "withdrawal") {
      const payoutId = String(event.transactionId ?? "");
      if (!payoutId) return NextResponse.json({ ok: true, matched: false });
      const w = await prisma.withdrawal.findUnique({ where: { payoutId } });
      if (!w) return NextResponse.json({ ok: true, matched: false });
      const result = signed
        ? await handlePayoutEvent(payoutId, payoutFromRecord({ ...event, transactionHash: event.blockchainTxHash }))
        : await checkPayout(w.id);
      return NextResponse.json({ ok: true, matched: true, status: result.withdrawal?.status });
    }
  } catch (e: any) {
    // Polling (return page, sweep) will catch up; don't make 3Pay hammer us with retries.
    console.error(`[3pay-webhook] ${type}: ${e?.message || e}`);
    return NextResponse.json({ ok: true, error: "processing deferred" });
  }

  return NextResponse.json({ ok: true, ignored: type || "unknown" });
}
