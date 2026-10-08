import { PublicFooter, PublicHeader } from "@/components/PublicHeader";
import { prisma } from "@/lib/db";
import { DepositForm } from "./DepositForm";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Enter your details", body: "Your nexQ MT5 account number and the amount you'd like to add." },
  { title: "Review the summary", body: "Double-check the account and total before you continue." },
  { title: "Confirm with Whish", body: "Approve the payment with the code Whish sends you." },
  { title: "Funds land automatically", body: "Your balance is credited the moment Whish confirms." },
];

// Public deposit page — no login required.
export default async function DepositPage() {
  const cfg = await prisma.providerConfig.findUnique({ where: { id: "rival" }, select: { minDeposit: true } });
  const minDeposit = cfg?.minDeposit ?? 0;
  return (
    <>
      <PublicHeader />
      <main className="mx-auto grid max-w-5xl gap-10 px-5 py-8 sm:py-12 md:grid-cols-[1fr_420px] md:gap-14">
        <section className="animate-fade-up">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">nexQ Funding</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
            Top up your account, <span className="text-brand-gradient">the next standard</span> way.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted">
            Add funds to your nexQ MT5 account in a few taps with{" "}
            <span className="font-semibold text-ink">Whish Pay</span>. No card details, no waiting for a transfer.
          </p>

          <ol className="mt-8 hidden space-y-5 md:block">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="bg-brand-gradient grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{s.title}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="animate-fade-up md:pt-2" style={{ animationDelay: "60ms" }}>
          <DepositForm minDeposit={minDeposit} />
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
