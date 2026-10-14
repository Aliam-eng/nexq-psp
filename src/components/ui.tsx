import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import { AdminNav } from "./AdminNav";

// --- Brand mark ----------------------------------------------------------
// "onDark" = white wordmark for charcoal bands; "onLight" = charcoal wordmark for light pages.
export function Logo({ href = "/deposit", tone = "onDark" }: { href?: string; tone?: "onDark" | "onLight" }) {
  return (
    <Link href={href} className="inline-flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={tone === "onDark" ? "/logo-nexq.png" : "/logo-nexq-dark.png"}
        alt="nexQ"
        className="h-7 w-auto select-none"
      />
    </Link>
  );
}

// --- Status badge --------------------------------------------------------
const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-surface-overlay text-ink-muted" },
  LINK_GENERATED: { label: "Awaiting payment", cls: "bg-amber-100 text-amber-800" },
  PAID: { label: "Paid · crediting", cls: "bg-sky-100 text-sky-800" },
  CREDITED: { label: "Completed", cls: "bg-emerald-100 text-emerald-800" },
  CREDIT_FAILED: { label: "Paid · MT5 failed", cls: "bg-orange-100 text-orange-800" },
  FAILED: { label: "Failed", cls: "bg-rose-100 text-rose-800" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.PENDING;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  );
}

// --- Admin top bar -------------------------------------------------------
export function TopBar({ user }: { user: { email: string; role: string } }) {
  return (
    <header className="sticky top-0 z-30 bg-charcoal/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <Logo href="/admin/transactions" />
            <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
              Back office
            </span>
          </div>
          <AdminNav />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden items-center gap-2 text-white/70 sm:flex">
            <span className="bg-brand-gradient grid h-7 w-7 place-items-center rounded-full text-xs font-bold uppercase text-white">
              {user.email.charAt(0)}
            </span>
            {user.email}
          </span>
          <LogoutButton onDark />
        </div>
      </div>
      <div className="bg-brand-gradient h-0.5" />
    </header>
  );
}

// --- Admin page heading --------------------------------------------------
export function PageHeader({ title, subtitle }: { title: string; subtitle: React.ReactNode }) {
  return (
    <div className="animate-fade-up">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">nexQ Back office</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
    </div>
  );
}

// --- Stat tile -----------------------------------------------------------
const TONE = { ink: "text-ink", success: "text-success", gold: "text-gold", danger: "text-danger" };

export function StatCard({ label, value, tone = "ink" }: { label: string; value: string; tone?: keyof typeof TONE }) {
  return (
    <div className="card overflow-hidden">
      <div className="bg-brand-gradient h-0.5 opacity-70" />
      <div className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">{label}</p>
        <p className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${TONE[tone]}`}>{value}</p>
      </div>
    </div>
  );
}
