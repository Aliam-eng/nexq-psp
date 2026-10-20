import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/access";
import { prisma } from "@/lib/db";
import { AdminShell } from "@/components/ui";
import { TransactionsTable } from "./TransactionsTable";

export const dynamic = "force-dynamic";

export default async function AdminTransactions() {
  const session = await currentStaff();
  if (!session) redirect("/login");

  const txns = await prisma.transaction.findMany({
    orderBy: { createdAt: "desc" },
    include: { user: true },
    take: 200,
  });

  const rows = txns.map((t) => ({
    id: t.id,
    reference: t.reference,
    client: t.user?.email ?? t.clientEmail ?? "guest",
    mt5Login: t.mt5Login,
    amount: t.amount,
    grossAmount: t.grossAmount,
    method: t.method,
    currency: t.currency,
    status: t.status,
    whishExternalId: t.whishExternalId,
    mt5DealId: t.mt5DealId,
    errorMessage: t.errorMessage,
    createdAt: t.createdAt.toISOString(),
  }));

  const sum = (pred: (s: string) => boolean) =>
    rows.filter((r) => pred(r.status)).reduce((a, r) => a + r.amount, 0);
  const count = (...statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).length;
  const attention = count("CREDIT_FAILED");

  return (
    <AdminShell user={session} title="Deposits" subtitle="Every deposit — Whish Pay and USDT — from payment to MT5 credit.">
      {/* One summary panel, not a row of cards */}
      <section className="card grid grid-cols-3 divide-x divide-line animate-fade-up md:grid-cols-4">
        <div className="col-span-3 border-b border-line p-5 md:col-span-1 md:border-b-0">
          <p className="text-xs font-semibold text-ink-muted">Funded volume</p>
          <p className="text-brand-gradient mt-1 text-3xl font-extrabold tabular-nums">
            ${sum((s) => s === "CREDITED").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="mt-1 text-xs text-ink-dim">credited to MT5 · last {rows.length} deposits</p>
        </div>
        <Metric label="Completed" value={count("CREDITED")} dot="bg-emerald-500" />
        <Metric label="In progress" value={count("LINK_GENERATED", "PAID")} dot="bg-amber-500" />
        <Metric
          label="Needs attention"
          value={attention}
          dot={attention ? "bg-orange-500" : "bg-line-strong"}
          note={attention ? "paid, MT5 credit failed" : "all clear"}
        />
      </section>

      <div className="mt-6 animate-fade-up" style={{ animationDelay: "60ms" }}>
        <TransactionsTable rows={rows} />
      </div>
    </AdminShell>
  );
}

function Metric({ label, value, dot, note }: { label: string; value: number; dot: string; note?: string }) {
  return (
    <div className="p-4 md:p-5">
      <p className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
        <span className={`h-2 w-2 rounded-full ${dot}`} /> {label}
      </p>
      <p className="mt-1 text-3xl font-extrabold tabular-nums text-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-ink-dim">{note}</p>}
    </div>
  );
}
