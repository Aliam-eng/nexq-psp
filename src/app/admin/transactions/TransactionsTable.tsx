"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui";

type Row = {
  id: string;
  reference: string;
  client: string;
  mt5Login: string;
  amount: number;
  currency: string;
  status: string;
  whishExternalId: string | null;
  mt5DealId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

const TABS: { key: string; label: string; statuses: string[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "open", label: "In progress", statuses: ["PENDING", "LINK_GENERATED", "PAID"] },
  { key: "done", label: "Completed", statuses: ["CREDITED"] },
  { key: "attention", label: "Needs attention", statuses: ["CREDIT_FAILED"] },
  { key: "failed", label: "Failed", statuses: ["FAILED"] },
];

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function TransactionsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, t.statuses ? rows.filter((r) => t.statuses!.includes(r.status)).length : rows.length])),
    [rows]
  );

  const filtered = useMemo(() => {
    const statuses = TABS.find((t) => t.key === tab)?.statuses;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!statuses || statuses.includes(r.status)) &&
        (!q || [r.reference, r.mt5Login, r.client, r.mt5DealId ?? ""].some((v) => v.toLowerCase().includes(q)))
    );
  }, [rows, tab, query]);

  async function syncOne(id: string) {
    setBusy(id);
    await fetch(`/api/deposits/${id}/sync`, { method: "POST" });
    setBusy(null);
    router.refresh();
  }
  async function sweepAll() {
    setBusy("sweep");
    await fetch("/api/sweep", { method: "POST" });
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="card overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-5">
        <div className="relative min-w-[220px] flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search by reference, MT5 account, client or deal ID"
            className="w-full rounded-full border border-line bg-surface-raised py-2 pl-9 pr-4 text-sm text-ink outline-none transition focus:border-brand focus:bg-white focus:shadow-focus"
          />
        </div>
        <button onClick={sweepAll} disabled={busy === "sweep"} className="btn-ghost px-4 py-2 text-xs">
          <RefreshIcon spinning={busy === "sweep"} /> {busy === "sweep" ? "Checking Whish…" : "Check pending"}
        </button>
      </div>

      {/* Underlined tabs with counts */}
      <div className="flex gap-6 overflow-x-auto border-b border-line px-4 md:px-5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative flex shrink-0 items-center gap-2 py-3 text-sm font-semibold transition ${
              tab === t.key ? "text-ink" : "text-ink-dim hover:text-ink-muted"
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 py-px text-[11px] tabular-nums ${
                tab === t.key ? "bg-ink text-white" : "bg-surface-overlay text-ink-muted"
              }`}
            >
              {counts[t.key]}
            </span>
            {tab === t.key && <span className="bg-brand-gradient absolute inset-x-0 -bottom-px h-0.5 rounded-full" />}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-overlay text-ink-dim">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 7h18M3 12h18M3 17h12" />
            </svg>
          </span>
          <p className="mt-3 text-sm font-semibold text-ink">{query ? "No matches" : "No deposits here"}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {query ? "Try a reference, MT5 account or deal ID." : "Deposits will appear as clients pay."}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="whitespace-nowrap text-left text-xs font-semibold text-ink-dim">
                <th className="px-5 py-3 font-semibold">Deposit</th>
                <th className="px-5 py-3 font-semibold">MT5 account</th>
                <th className="px-5 py-3 text-right font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Deal ID</th>
                <th className="w-12 px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((r) => (
                <tr key={r.id} className="group align-top transition hover:bg-surface-raised">
                  <td className="px-5 py-3.5">
                    <p className="font-mono text-[13px] font-semibold text-ink">{r.reference}</p>
                    <p className="mt-0.5 text-xs text-ink-dim" suppressHydrationWarning>
                      {when(r.createdAt)} · {r.client}
                    </p>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-ink">{r.mt5Login}</td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-right">
                    <span className="font-bold tabular-nums text-ink">{r.amount.toFixed(2)}</span>{" "}
                    <span className="text-xs text-ink-dim">{r.currency}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={r.status} />
                    {r.errorMessage && (
                      <p className="mt-1 max-w-[18rem] truncate text-xs text-danger" title={r.errorMessage}>
                        {r.errorMessage}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-ink-muted">{r.mt5DealId || "—"}</td>
                  <td className="px-5 py-3.5 text-right">
                    <RowRefresh busy={busy === r.id} onClick={() => syncOne(r.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile cards */}
          <ul className="divide-y divide-line md:hidden">
            {filtered.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-4">
                <div className="min-w-0">
                  <p className="font-mono text-[13px] font-semibold text-ink">{r.reference}</p>
                  <p className="mt-0.5 text-xs text-ink-dim" suppressHydrationWarning>
                    MT5 {r.mt5Login} · {when(r.createdAt)}
                  </p>
                  <div className="mt-2">
                    <StatusBadge status={r.status} />
                  </div>
                  {r.errorMessage && <p className="mt-1 truncate text-xs text-danger">{r.errorMessage}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <p className="font-bold tabular-nums text-ink">
                    {r.amount.toFixed(2)} <span className="text-xs font-semibold text-ink-dim">{r.currency}</span>
                  </p>
                  <RowRefresh busy={busy === r.id} onClick={() => syncOne(r.id)} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function RowRefresh({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Check this deposit with Whish now"
      aria-label="Check this deposit with Whish now"
      className="grid h-8 w-8 place-items-center rounded-full border border-line text-ink-muted transition hover:border-brand hover:text-brand-400 disabled:opacity-50"
    >
      <RefreshIcon spinning={busy} />
    </button>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
    </svg>
  );
}
