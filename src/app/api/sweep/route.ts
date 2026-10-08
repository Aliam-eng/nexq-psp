import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sweepPending } from "@/lib/flow";

// Reconcile all non-terminal transactions. Call from the dashboard refresh,
// or schedule (cron / Vercel cron) hitting this with a header secret in prod.
export async function POST(req: Request) {
  const session = await getSession();
  const cronSecret = req.headers.get("x-cron-secret");
  const allowed =
    (session && session.role === "TECHNICAL") ||
    (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const results = await sweepPending();
  return NextResponse.json({ ok: true, count: Object.keys(results).length, results });
}
