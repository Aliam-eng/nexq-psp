import { NextResponse } from "next/server";
import { currentStaff } from "@/lib/access";
import { approveWithdrawal } from "@/lib/withdrawals";

// Approve → deduct from the client's MT5 balance. Admins and operators.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await approveWithdrawal(params.id, staff);
  if (result.ok) return NextResponse.json({ ok: true, status: result.withdrawal.status, mt5DealId: result.withdrawal.mt5DealId });
  const status = result.code === "NOT_FOUND" ? 404 : result.code === "NOT_ACTIONABLE" ? 409 : 502;
  return NextResponse.json({ error: result.message, status: result.withdrawal?.status }, { status });
}
