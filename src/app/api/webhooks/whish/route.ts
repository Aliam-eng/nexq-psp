import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcileTransaction } from "@/lib/flow";

// Whish Pay callback receiver. We pass this URL as successCallbackUrl / failureCallbackUrl
// on every payment, with our own ?externalId=…&result=… appended (Whish adds nothing itself).
//
// Callbacks are unauthenticated GETs with no body, so they only TRIGGER a reconcile:
// we re-fetch the authoritative status from Whish and credit MT5 only on "success".
// A failure callback means one attempt failed — the link stays payable, so it never
// fails the deposit by itself. Always answer 200 so Whish treats it as delivered.

export async function GET(req: Request) {
  const externalId = new URL(req.url).searchParams.get("externalId");
  if (!externalId) return NextResponse.json({ ok: true, matched: false });

  const tx = await prisma.transaction.findUnique({ where: { whishExternalId: externalId } });
  if (!tx) return NextResponse.json({ ok: true, matched: false });

  try {
    const updated = await reconcileTransaction(tx.id);
    return NextResponse.json({ ok: true, matched: true, status: updated?.status ?? tx.status });
  } catch (e: any) {
    // Polling (return page + sweep) will pick it up; don't make Whish retry into an error.
    console.error(`[whish-callback] ${tx.id}: ${e?.message || e}`);
    return NextResponse.json({ ok: true, matched: true, status: tx.status });
  }
}

export const POST = GET;
