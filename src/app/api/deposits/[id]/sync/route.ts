import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcileTransaction } from "@/lib/flow";

// Public status check for a deposit. Pulls the latest status from Rival and
// credits MT5 if newly paid. Safe to expose: crediting only occurs when Rival
// reports PAID, and the operation is idempotent.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const tx = await prisma.transaction.findUnique({ where: { id: params.id } });
  if (!tx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await reconcileTransaction(params.id);
  return NextResponse.json({
    ok: true,
    status: updated?.status,
    mt5DealId: updated?.mt5DealId ?? null,
    errorMessage: updated?.errorMessage ?? null,
  });
}

export const GET = POST;
