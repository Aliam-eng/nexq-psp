import { PublicFooter, PublicHeader } from "@/components/PublicHeader";
import { WithdrawForm } from "./WithdrawForm";
import { withdrawalMethods } from "@/lib/withdrawals";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Request a withdrawal", body: "Your MT5 account, the amount, and where to send it: Whish or USDT (TRC20)." },
  { title: "We review it", body: "Our team checks every request before any money moves." },
  { title: "Paid out", body: "Once approved, the amount leaves your MT5 balance and is sent to your Whish wallet or USDT address." },
];

// Public withdrawal request page — no login required; every request is reviewed.
export default async function WithdrawPage() {
  const methods = await withdrawalMethods(); // only methods switched on in Settings
  return (
    <>
      <PublicHeader />

      <section className="band">
        <div className="mx-auto grid max-w-5xl gap-8 px-5 pb-28 pt-10 sm:pt-14 md:grid-cols-[1fr_420px] md:gap-14 md:pb-20">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
              <span className="bg-brand-gradient h-1.5 w-1.5 rounded-full" /> Withdrawals
            </span>
            <h1 className="mt-4 text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-[2.6rem]">
              Cash out to <span className="text-brand-gradient">Whish or USDT.</span>
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
              Request a withdrawal from your nexQ MT5 account. Every request is checked by our team before any money
              moves.
            </p>
          </div>
        </div>
      </section>

      <main className="mx-auto grid max-w-5xl gap-10 px-5 md:grid-cols-[1fr_420px] md:gap-14">
        <section className="order-2 animate-fade-up md:order-1 md:pt-10">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-dim">How it works</h2>
          <ol className="mt-5 grid gap-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
                <span className="text-brand-gradient text-2xl font-extrabold leading-none">0{i + 1}</span>
                <div>
                  <p className="text-sm font-bold text-ink">{s.title}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="order-1 -mt-20 animate-fade-up md:order-2 md:-mt-64" style={{ animationDelay: "60ms" }}>
          <WithdrawForm methods={methods} />
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
