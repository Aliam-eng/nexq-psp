import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/access";
import { prisma } from "@/lib/db";
import { AdminShell } from "@/components/ui";
import { WithdrawalsTable } from "./WithdrawalsTable";

export const dynamic = "force-dynamic";

export default async function AdminWithdrawals() {
  const staff = await currentStaff();
  if (!staff) redirect("/login");

  const list = await prisma.withdrawal.findMany({
    orderBy: { createdAt: "desc" },
    include: { decidedBy: { select: { email: true } } },
    take: 300,
  });

  const rows = list.map((w) => ({
    id: w.id,
    reference: w.reference,
    mt5Login: w.mt5Login,
    amount: w.amount,
    currency: w.currency,
    method: w.method,
    phone: w.phone,
    walletAddress: w.walletAddress,
    payoutTxHash: w.payoutTxHash,
    payoutNet: w.payoutNet,
    payoutError: w.payoutError,
    refundDealId: w.refundDealId,
    status: w.status,
    rejectionReason: w.rejectionReason,
    errorMessage: w.errorMessage,
    mt5DealId: w.mt5DealId,
    decidedBy: w.decidedBy?.email ?? null,
    decidedAt: w.decidedAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
  }));

  const pending = rows.filter((r) => r.status === "PENDING");
  const pendingAmount = pending.reduce((a, r) => a + r.amount, 0);
  const paidOut = rows.filter((r) => r.status === "COMPLETED").reduce((a, r) => a + r.amount, 0);
  const failed = rows.filter((r) => ["FAILED", "PAYOUT_FAILED", "PAYOUT_UNKNOWN"].includes(r.status)).length;
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <AdminShell user={staff} title="Withdrawals" subtitle="Client requests — approving deducts the amount from their MT5 account.">
      <section className="card grid grid-cols-3 divide-x divide-line animate-fade-up md:grid-cols-4">
        <div className="col-span-3 border-b border-line p-5 md:col-span-1 md:border-b-0">
          <p className="text-xs font-semibold text-ink-muted">Awaiting review</p>
          <p className="text-brand-gradient mt-1 text-3xl font-extrabold tabular-nums">${money(pendingAmount)}</p>
          <p className="mt-1 text-xs text-ink-dim">
            {pending.length} request{pending.length === 1 ? "" : "s"}
          </p>
        </div>
        <Metric label="Pending" value={String(pending.length)} dot="bg-amber-500" />
        <Metric label="Withdrawn" value={`$${money(paidOut)}`} dot="bg-emerald-500" note="deducted from MT5" />
        <Metric
          label="Needs attention"
          value={String(failed)}
          dot={failed ? "bg-rose-500" : "bg-line-strong"}
          note={failed ? "MT5 or payout problem" : "all clear"}
        />
      </section>

      <div className="mt-6 animate-fade-up" style={{ animationDelay: "60ms" }}>
        <WithdrawalsTable rows={rows} />
      </div>
    </AdminShell>
  );
}

function Metric({ label, value, dot, note }: { label: string; value: string; dot: string; note?: string }) {
  return (
    <div className="p-4 md:p-5">
      <p className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
        <span className={`h-2 w-2 rounded-full ${dot}`} /> {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink md:text-3xl">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-dim">{note}</p>}
    </div>
  );
}
