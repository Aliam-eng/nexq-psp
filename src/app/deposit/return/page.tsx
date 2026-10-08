import { prisma } from "@/lib/db";
import { PublicFooter, PublicHeader } from "@/components/PublicHeader";
import { ReturnStatus } from "./ReturnStatus";

// Public status page. Reached via our redirect (?tx=) or Rival's (?ref=).
export default async function ReturnPage({ searchParams }: { searchParams: { tx?: string; ref?: string } }) {
  const tx = searchParams.tx
    ? await prisma.transaction.findUnique({ where: { id: searchParams.tx } })
    : searchParams.ref
    ? await prisma.transaction.findFirst({ where: { rivalPaymentId: searchParams.ref } })
    : null;

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-xl px-5 py-10 sm:py-14">
        <p className="animate-fade-up text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">nexQ Funding</p>
        <h1 className="mt-2 animate-fade-up text-2xl font-bold tracking-tight text-ink sm:text-3xl">Your deposit</h1>
        {!tx ? (
          <div className="card mt-6 p-6 text-sm text-ink-muted animate-fade-up">
            We couldn&apos;t find this deposit. If you just paid, use{" "}
            <a href="/deposit/status" className="font-medium text-brand-400 hover:underline">
              Track a deposit
            </a>{" "}
            with your reference.
          </div>
        ) : (
          <div className="mt-6 animate-fade-up">
            <ReturnStatus
              txId={tx.id}
              reference={tx.reference}
              amount={tx.amount}
              currency={tx.currency}
              mt5Login={tx.mt5Login}
              initialStatus={tx.status}
            />
          </div>
        )}
      </main>
      <PublicFooter />
    </>
  );
}
