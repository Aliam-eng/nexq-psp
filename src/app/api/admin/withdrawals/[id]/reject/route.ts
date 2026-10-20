import { NextResponse } from "next/server";
import { z } from "zod";
import { currentStaff } from "@/lib/access";
import { rejectWithdrawal } from "@/lib/withdrawals";

const schema = z.object({ reason: z.string().max(500) });

// Reject with a reason (nothing is deducted). Admins and operators.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please give a reason for the rejection" }, { status: 400 });

  const result = await rejectWithdrawal(params.id, staff, parsed.data.reason);
  if (result.ok) return NextResponse.json({ ok: true, status: result.withdrawal.status });
  const status = result.code === "NOT_FOUND" ? 404 : result.code === "NOT_ACTIONABLE" ? 409 : 400;
  return NextResponse.json({ error: result.message }, { status });
}
