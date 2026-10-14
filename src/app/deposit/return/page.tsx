import { prisma } from "@/lib/db";
import { PublicFooter, PublicHeader } from "@/components/PublicHeader";
import { ReturnStatus } from "./ReturnStatus";

// Public status page. Whish redirects the payer here (?tx=) after a payment attempt.
export default async function ReturnPage({ searchParams }: { searchParams: { tx?: string } }) {
  const tx = searchParams.tx ? await prisma.transaction.findUnique({ where: { id: searchParams.tx } }) : null;

  return (
    <>
      <PublicHeader />
      <section className="band">
        <div className="mx-auto max-w-xl px-5 pb-24 pt-10">
          <h1 className="animate-fade-up text-2xl font-extrabold tracking-tight sm:text-3xl">Deposit status</h1>
          <p className="mt-1 text-sm text-white/70">Live from Whish Pay and your MT5 account.</p>
        </div>
      </section>
      <main className="mx-auto -mt-16 max-w-xl px-5">
        {!tx ? (
          <div className="card p-6 text-sm text-ink-muted animate-fade-up">
            We couldn&apos;t find this deposit.{" "}
            <a href="/deposit" className="font-medium text-brand-400 hover:underline">
              Make a new deposit
            </a>
          </div>
        ) : (
          <div className="animate-fade-up">
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
