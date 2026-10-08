import Link from "next/link";
import { Logo } from "./ui";

// Header for the public (no-login) deposit pages — mirrors the charcoal bar
// on nexqcapital.com, finished with the Q-mark gradient hairline.
export function PublicHeader() {
  return (
    <header className="sticky top-0 z-30 bg-charcoal/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5">
        <Logo href="/deposit" />
        <nav className="flex items-center gap-1 text-[13px] font-medium">
          <Link href="/deposit/status" className="btn-quiet">
            Track a deposit
          </Link>
          <a
            href="https://www.nexqcapital.com/"
            className="btn-quiet hidden sm:inline-flex"
            target="_blank"
            rel="noopener noreferrer"
          >
            nexqcapital.com ↗
          </a>
        </nav>
      </div>
      <div className="bg-brand-gradient h-0.5" />
    </header>
  );
}

// Shared footer for the public pages.
export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-line/70">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-8 text-xs leading-relaxed text-ink-dim sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-xl">
          Deposits are processed through Whish Pay and credited to your nexQ MT5 trading account. Trading leveraged
          products carries a high level of risk and may not be suitable for all investors.
        </p>
        <p className="shrink-0">© {new Date().getFullYear()} nexQ Capital</p>
      </div>
    </footer>
  );
}
