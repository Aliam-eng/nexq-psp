import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcileTransaction } from "@/lib/flow";

// Webhook receiver for Rival payment events.
// Register this URL in Rival:  {APP_BASE_URL}/api/webhooks/rival
//
// Design: the webhook only TRIGGERS a reconcile. We extract the payment's
// externalId from the payload, then re-fetch the authoritative status from
// Rival's API and credit MT5 — so we never blindly trust the webhook body.
// Verification: optional shared secret (header or ?secret=) matched against
// ProviderConfig.webhookSecret. Even unverified calls are low-risk (they only
// re-check status), but the secret stops spam.

function extractExternalId(body: any, url: URL): string | null {
  if (!body || typeof body !== "object") body = {};
  const d = body.data && typeof body.data === "object" ? body.data : body;
  return (
    d.externalId ||
    d.external_id ||
    d.paymentId ||
    d.payment_id ||
    d.id ||
    body.externalId ||
    body.ref ||
    url.searchParams.get("externalId") ||
    url.searchParams.get("ref") ||
    null
  );
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const cfg = await prisma.providerConfig.findUnique({
    where: { id: "rival" },
    select: { webhookSecret: true },
  });

  // Verify shared secret if one is configured.
  if (cfg?.webhookSecret) {
    const provided =
      req.headers.get("x-webhook-secret") ||
      req.headers.get("x-rival-signature") ||
      (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
      url.searchParams.get("secret") ||
      "";
    if (provided !== cfg.webhookSecret) {
      return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
    }
  }

  const raw = await req.text();
  let body: any = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    /* tolerate non-JSON / form bodies */
  }

  const externalId = extractExternalId(body, url);
  if (!externalId) {
    return NextResponse.json({ ok: false, error: "No externalId in payload" }, { status: 202 });
  }

  const tx = await prisma.transaction.findFirst({ where: { rivalPaymentId: String(externalId) } });
  if (!tx) {
    // Unknown payment — acknowledge so Rival doesn't keep retrying.
    return NextResponse.json({ ok: true, matched: false });
  }

  const updated = await reconcileTransaction(tx.id);
  return NextResponse.json({ ok: true, matched: true, status: updated?.status ?? tx.status });
}

// Some providers verify the endpoint with a GET first.
export async function GET() {
  return NextResponse.json({ ok: true, service: "rival-webhook" });
}
