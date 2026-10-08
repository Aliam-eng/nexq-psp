"use client";

import { useState } from "react";
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
  rivalPaymentId: string | null;
  mt5DealId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

const FILTERS = ["ALL", "LINK_GENERATED", "PAID", "CREDITED", "CREDIT_FAILED", "FAILED"];
const FILTER_LABEL: Record<string, string> = {
  ALL: "All",
  LINK_GENERATED: "Awaiting payment",
  PAID: "Paid",
  CREDITED: "Completed",
  CREDIT_FAILED: "MT5 failed",
  FAILED: "Failed",
};

export function TransactionsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("ALL");
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = filter === "ALL" ? rows : rows.filter((r) => r.status === filter);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`chip ${filter === f ? "chip-active" : ""}`}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
        <button onClick={sweepAll} disabled={busy === "sweep"} className="btn-ghost ml-auto px-3 py-1.5 text-xs">
          {busy === "sweep" ? "Refreshing…" : "↻ Refresh pending"}
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line/70 bg-surface-raised/50 text-left text-[11px] uppercase tracking-wider text-ink-dim">
              <th className="px-4 py-3 font-semibold">Reference</th>
              <th className="px-4 py-3 font-semibold">Client</th>
              <th className="px-4 py-3 font-semibold">MT5 account</th>
              <th className="px-4 py-3 font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Deal ID</th>
              <th className="px-4 py-3 font-semibold">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-14 text-center text-ink-dim">
                  Nothing here yet — deposits will show up as clients pay.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-line/40 align-top transition hover:bg-surface-overlay/40 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-ink">{r.reference}</td>
                <td className="px-4 py-3 text-ink-muted">{r.client}</td>
                <td className="px-4 py-3 font-mono text-ink">{r.mt5Login}</td>
                <td className="px-4 py-3 font-medium text-ink">
                  {r.amount.toFixed(2)} <span className="text-ink-dim">{r.currency}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                  {r.errorMessage && <div className="mt-1 max-w-[16rem] truncate text-xs text-danger/80" title={r.errorMessage}>{r.errorMessage}</div>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-muted">{r.mt5DealId || "—"}</td>
                <td className="px-4 py-3 text-ink-dim">{r.createdAt.slice(0, 16).replace("T", " ")}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => syncOne(r.id)} disabled={busy === r.id} className="btn-ghost px-2.5 py-1 text-xs">
                    {busy === r.id ? "…" : "Refresh"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
