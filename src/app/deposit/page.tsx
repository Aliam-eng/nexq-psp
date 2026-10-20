import { PublicFooter, PublicHeader } from "@/components/PublicHeader";
import { prisma } from "@/lib/db";
import { DepositForm, type DepositMethod } from "./DepositForm";
import { getWhishCredentials } from "@/lib/whish";
import { getThreePayConfig } from "@/lib/threepay";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Enter your details", body: "Your nexQ MT5 account number and the amount you'd like to add." },
  { title: "Pay with Whish or USDT", body: "Approve in the Whish app, or send USDT on the TRON (TRC20) network." },
  { title: "Funds land automatically", body: "Your balance is credited as soon as the payment is confirmed." },
];

// Public deposit page — no login required.
export default async function DepositPage() {
  // Only offer the payment methods that are switched on in Settings.
  const [whish, whishRow, threepay] = await Promise.all([
    getWhishCredentials(),
    prisma.providerConfig.findUnique({ where: { id: "whish" }, select: { minDeposit: true } }),
    getThreePayConfig(),
  ]);
  const methods: DepositMethod[] = [];
  if (whish.enabled) methods.push({ key: "WHISH", min: Math.max(whishRow?.minDeposit ?? 0, 1) });
  if (threepay.enabled) methods.push({ key: "USDT_TRC20", min: Math.max(threepay.minDeposit, 1) });
  return (
    <>
      <PublicHeader />

      {/* Charcoal hero band */}
      <section className="band">
        <div className="mx-auto grid max-w-5xl gap-8 px-5 pb-28 pt-10 sm:pt-14 md:grid-cols-[1fr_420px] md:gap-14 md:pb-20">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
              <span className="bg-brand-gradient h-1.5 w-1.5 rounded-full" /> Instant funding
            </span>
            <h1 className="mt-4 text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-[2.6rem]">
              Fund your trading account in <span className="text-brand-gradient">seconds.</span>
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
              Pay from your <span className="font-semibold text-white">Whish</span> wallet or with{" "}
              <span className="font-semibold text-white">USDT</span>. No card details, no bank transfer, no waiting.
            </p>
          </div>
        </div>
      </section>

      <main className="mx-auto grid max-w-5xl gap-10 px-5 md:grid-cols-[1fr_420px] md:gap-14">
        {/* How it works — under the band on desktop, under the form on mobile */}
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

        {/* Form card overlaps the hero band */}
        <section className="order-1 -mt-20 animate-fade-up md:order-2 md:-mt-64" style={{ animationDelay: "60ms" }}>
          <DepositForm methods={methods} />
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
