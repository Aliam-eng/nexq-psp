import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import { AdminNav } from "./AdminNav";

// --- Brand mark ----------------------------------------------------------
export function Logo({ href = "/deposit" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-nexq.png" alt="nexQ Deposit" className="h-7 w-auto select-none" />
    </Link>
  );
}

// --- Status badge --------------------------------------------------------
const STATUS: Record<string, { label: string; dot: string; cls: string }> = {
  PENDING: { label: "Pending", dot: "bg-ink-muted", cls: "text-ink-muted border-line bg-surface-raised/50" },
  LINK_GENERATED: { label: "Awaiting payment", dot: "bg-gold", cls: "text-gold border-gold/25 bg-gold/10" },
  PAID: { label: "Paid · crediting", dot: "bg-brand", cls: "text-brand-400 border-brand/30 bg-brand/10" },
  CREDITED: { label: "Completed", dot: "bg-success", cls: "text-success border-success/30 bg-success/10" },
  CREDIT_FAILED: { label: "Paid · MT5 failed", dot: "bg-orange-400", cls: "text-orange-300 border-orange-400/25 bg-orange-400/10" },
  FAILED: { label: "Failed", dot: "bg-danger", cls: "text-danger border-danger/25 bg-danger/10" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.PENDING;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${s.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${status === "PENDING" || status === "FAILED" ? "" : "animate-pulse-soft"}`} />
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
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              Back office
            </span>
          </div>
          <AdminNav />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden items-center gap-2 text-ink-muted sm:flex">
            <span className="bg-brand-gradient grid h-7 w-7 place-items-center rounded-full text-xs font-bold uppercase text-white">
              {user.email.charAt(0)}
            </span>
            {user.email}
          </span>
          <LogoutButton />
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
