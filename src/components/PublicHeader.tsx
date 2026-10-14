import { Logo } from "./ui";

// Header for the public (no-login) deposit pages — the charcoal bar from nexqcapital.com.
export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 bg-charcoal">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
        <Logo href="/deposit" />
        <a
          href="https://www.nexqcapital.com/"
          className="btn-on-dark hidden text-[13px] sm:inline-flex"
          target="_blank"
          rel="noopener noreferrer"
        >
          nexqcapital.com ↗
        </a>
      </div>
    </header>
  );
}

// Shared footer for the public pages.
export function PublicFooter() {
  return (
    <footer className="mt-20 bg-charcoal-deep text-white/60">
      <div className="bg-brand-gradient h-1" />
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-8 text-xs leading-relaxed sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl space-y-3">
          <Logo href="/deposit" />
          <p>
            Deposits are processed through Whish Pay and credited to your nexQ MT5 trading account. Trading leveraged
            products carries a high level of risk and may not be suitable for all investors.
          </p>
        </div>
        <p className="shrink-0">© {new Date().getFullYear()} nexQ Capital</p>
      </div>
    </footer>
  );
}
