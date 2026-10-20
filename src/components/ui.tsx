import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import { AdminNav } from "./AdminNav";
import { ROLE_LABEL } from "@/lib/roles";

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

// --- Withdrawal status badge -----------------------------------------------
const WD_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pending review", cls: "bg-amber-100 text-amber-800" },
  PROCESSING: { label: "Processing", cls: "bg-sky-100 text-sky-800" },
  COMPLETED: { label: "Completed", cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Rejected", cls: "bg-surface-overlay text-ink-muted" },
  FAILED: { label: "MT5 failed", cls: "bg-rose-100 text-rose-800" },
  PAYOUT_PENDING: { label: "Sending USDT", cls: "bg-sky-100 text-sky-800" },
  PAYOUT_FAILED: { label: "Payout failed", cls: "bg-orange-100 text-orange-800" },
  PAYOUT_UNKNOWN: { label: "Payout unclear", cls: "bg-rose-100 text-rose-800" },
  REFUNDED: { label: "Refunded to MT5", cls: "bg-violet-100 text-violet-800" },
};

export function WithdrawalBadge({ status }: { status: string }) {
  const s = WD_STATUS[status] ?? WD_STATUS.PENDING;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${s.cls}`}>
      {s.label}
    </span>
  );
}

// --- Admin shell: charcoal sidebar (desktop) / compact bar (mobile) -------
export function AdminShell({
  user,
  title,
  subtitle,
  actions,
  children,
}: {
  user: { email: string; role: string; isAdmin?: boolean };
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_1fr]">
      {/* Sidebar */}
      <aside className="band sticky top-0 z-30 flex flex-col md:h-screen">
        <div className="flex items-center justify-between gap-3 px-5 py-4 md:block md:px-6 md:py-7">
          <div>
            <Logo href="/admin/transactions" />
            <p className="mt-1 hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50 md:block">
              Back office
            </p>
          </div>
          <div className="md:hidden">
            <LogoutButton onDark />
          </div>
        </div>
        <AdminNav isAdmin={!!user.isAdmin} />
        <div className="mt-auto hidden border-t border-white/10 px-4 py-4 md:block">
          <div className="flex items-center gap-3 px-2">
            <span className="bg-brand-gradient grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold uppercase text-white">
              {user.email.charAt(0)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{user.email}</p>
              <p className="text-xs text-white/50">{ROLE_LABEL[user.role] ?? user.role}</p>
            </div>
          </div>
          <div className="mt-3">
            <LogoutButton onDark />
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="min-w-0">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line bg-surface px-5 py-6 md:px-10">
          <div className="animate-fade-up">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
        <main className="px-5 py-6 md:px-10 md:py-8">{children}</main>
      </div>
    </div>
  );
}
