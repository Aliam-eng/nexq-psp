import Link from "next/link";
import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/access";
import { prisma } from "@/lib/db";
import { AdminShell } from "@/components/ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", label: "Everything" },
  { key: "withdrawal", label: "Withdrawals" },
  { key: "user", label: "Staff" },
  { key: "settings", label: "Settings" },
  { key: "auth", label: "Sign-ins" },
];

const ACTION: Record<string, { label: string; tone: string }> = {
  "withdrawal.approve": { label: "Approved withdrawal", tone: "bg-sky-100 text-sky-800" },
  "withdrawal.complete": { label: "Deducted from MT5", tone: "bg-emerald-100 text-emerald-800" },
  "withdrawal.fail": { label: "MT5 deduction failed", tone: "bg-rose-100 text-rose-800" },
  "withdrawal.reject": { label: "Rejected withdrawal", tone: "bg-orange-100 text-orange-800" },
  "user.create": { label: "Created account", tone: "bg-violet-100 text-violet-800" },
  "user.update": { label: "Updated account", tone: "bg-violet-100 text-violet-800" },
  "settings.whish": { label: "Changed Whish settings", tone: "bg-surface-overlay text-ink-muted" },
  "settings.mt5": { label: "Changed MT5 settings", tone: "bg-surface-overlay text-ink-muted" },
  "settings.password": { label: "Changed own password", tone: "bg-surface-overlay text-ink-muted" },
  "auth.login": { label: "Signed in", tone: "bg-surface-overlay text-ink-muted" },
  "auth.login_failed": { label: "Failed sign-in", tone: "bg-rose-100 text-rose-800" },
};

function describe(details: string | null): string {
  if (!details) return "";
  try {
    const d = JSON.parse(details) as Record<string, unknown>;
    return Object.entries(d)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      .join(" · ");
  } catch {
    return details;
  }
}

export default async function ActivityPage({ searchParams }: { searchParams: { type?: string } }) {
  const staff = await currentStaff();
  if (!staff) redirect("/login");
  if (!staff.isAdmin) redirect("/admin/transactions");

  const type = FILTERS.some((f) => f.key === searchParams.type) ? searchParams.type || "" : "";
  const entries = await prisma.auditLog.findMany({
    where: type ? { action: { startsWith: `${type}.` } } : undefined,
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return (
    <AdminShell user={staff} title="Activity log" subtitle="Who did what in the back office. Entries can't be edited or deleted.">
      <section className="card overflow-hidden">
        <div className="flex gap-6 overflow-x-auto border-b border-line px-5">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key ? `/admin/activity?type=${f.key}` : "/admin/activity"}
              className={`relative shrink-0 py-3 text-sm font-semibold transition ${type === f.key ? "text-ink" : "text-ink-dim hover:text-ink-muted"}`}
            >
              {f.label}
              {type === f.key && <span className="bg-brand-gradient absolute inset-x-0 -bottom-px h-0.5 rounded-full" />}
            </Link>
          ))}
        </div>

        {entries.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-ink-muted">No activity yet.</p>
        ) : (
          <ol className="divide-y divide-line">
            {entries.map((e) => {
              const a = ACTION[e.action] ?? { label: e.action, tone: "bg-surface-overlay text-ink-muted" };
              return (
                <li key={e.id} className="grid gap-1 px-5 py-3.5 md:grid-cols-[150px_220px_1fr] md:items-baseline md:gap-5">
                  <time className="text-xs tabular-nums text-ink-dim">
                    {e.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </time>
                  <p className="truncate text-sm font-semibold text-ink">{e.actorEmail}</p>
                  <div className="min-w-0 text-sm">
                    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${a.tone}`}>{a.label}</span>
                    {e.details && <span className="ml-2 break-words text-ink-muted">{describe(e.details)}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </AdminShell>
  );
}
