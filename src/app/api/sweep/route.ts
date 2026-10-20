import { NextResponse } from "next/server";
import { currentStaff } from "@/lib/access";
import { sweepPending } from "@/lib/flow";
import { sweepPayouts } from "@/lib/withdrawals";

// Reconcile all non-terminal transactions. Call from the dashboard refresh,
// or schedule (cron / Vercel cron) hitting this with a header secret in prod.
export async function POST(req: Request) {
  const staff = await currentStaff();
  const cronSecret = req.headers.get("x-cron-secret");
  const allowed =
    !!staff ||
    (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const results = await sweepPending();
  const payouts = await sweepPayouts(); // in-flight / unclear USDT payouts
  return NextResponse.json({ ok: true, count: Object.keys(results).length, results, payouts });
}
