import { NextResponse } from "next/server";
import { z } from "zod";
import { currentStaff } from "@/lib/access";
import { checkPayout, refundWithdrawal, retryPayout } from "@/lib/withdrawals";

// USDT payout follow-ups for a withdrawal whose MT5 deduction already happened:
//   check  — ask 3Pay what happened (PAYOUT_PENDING / PAYOUT_UNKNOWN)
//   retry  — send the payout again (PAYOUT_FAILED, nothing in flight at 3Pay)
//   refund — give the money back to the MT5 account instead (PAYOUT_FAILED)
const schema = z.object({
  action: z.enum(["check", "retry", "refund"]),
  reason: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const { action, reason } = parsed.data;

  const result =
    action === "check"
      ? await checkPayout(params.id, staff)
      : action === "retry"
      ? await retryPayout(params.id, staff)
      : await refundWithdrawal(params.id, staff, reason ?? "");

  if (result.ok) return NextResponse.json({ ok: true, status: result.withdrawal.status });
  const status =
    result.code === "NOT_FOUND" ? 404 : result.code === "NOT_ACTIONABLE" ? 409 : result.code === "REASON" ? 400 : result.code === "WAIT" ? 202 : 502;
  return NextResponse.json({ error: result.message, status: result.withdrawal?.status }, { status });
}
