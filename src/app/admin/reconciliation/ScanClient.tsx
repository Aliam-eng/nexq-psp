"use client";

import { useState } from "react";
import { StatCard } from "@/components/ui";

type DuplicateRow = {
  reference: string;
  login: string;
  amount: number;
  currency: string;
  count: number;
  extraCount: number;
  extraAmount: number;
  tickets: string[];
  createdAt: string;
};
type ScanResult = {
  ok: boolean;
  scannedTx: number;
  accounts: number;
  duplicates: DuplicateRow[];
  totalExtraAmount: number;
  errors: Record<string, string>;
  elapsedMs: number;
  detail?: string;
};

export function ScanClient() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/reconciliation/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Scan failed");
      else setResult(data);
    } catch (e: any) {
      setError(e?.message || "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!result) return;
    const header = "reference,login,amount,currency,credits,extraCredits,extraAmount,dealTickets\n";
    const body = result.duplicates
      .map((r) =>
        [r.reference, r.login, r.amount, r.currency, r.count, r.extraCount, r.extraAmount, r.tickets.join(" ")].join(",")
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mt5-duplicate-credits.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const errorCount = result ? Object.keys(result.errors).length : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={scan} disabled={loading} className="btn-primary">
          {loading ? "Scanning MT5…" : "Run duplicate scan →"}
        </button>
        {result && result.duplicates.length > 0 && (
          <button onClick={downloadCsv} className="btn-ghost">
            Download CSV
          </button>
        )}
        {loading && <span className="text-sm text-ink-muted">Querying MT5 for every account — this can take a bit.</span>}
      </div>

      {error && (
        <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      )}

      {result && !result.ok && (
        <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {result.detail || "Scan could not complete."}
        </p>
      )}

      {result && result.ok && (
        <>
          <p className="text-xs text-ink-dim">
            Scanned {result.accounts} account(s) in {(result.elapsedMs / 1000).toFixed(1)}s.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Deposits scanned", value: String(result.scannedTx), tone: "ink" as const },
              { label: "Accounts checked", value: String(result.accounts), tone: "ink" as const },
              { label: "Duplicated deposits", value: String(result.duplicates.length), tone: result.duplicates.length ? ("danger" as const) : ("success" as const) },
              { label: "Over-credited", value: `$${result.totalExtraAmount.toFixed(2)}`, tone: result.totalExtraAmount ? ("danger" as const) : ("success" as const) },
            ].map((s) => (
              <StatCard key={s.label} {...s} />
            ))}
          </div>

          {errorCount > 0 && (
            <p className="rounded-lg border border-gold/25 bg-gold/10 px-3 py-2 text-sm text-gold">
              {errorCount} account(s) couldn&apos;t be queried (e.g. not found on MT5) — they were skipped.
            </p>
          )}

          {result.duplicates.length === 0 ? (
            <div className="card p-6 text-sm text-ink-muted">
              All clear — every scanned deposit has exactly one MT5 balance deal. ✓
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-line/70 text-left text-xs uppercase tracking-wide text-ink-dim">
                    <th className="px-4 py-3 font-medium">Reference</th>
                    <th className="px-4 py-3 font-medium">MT5</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Credits</th>
                    <th className="px-4 py-3 font-medium">Over-credited</th>
                    <th className="px-4 py-3 font-medium">Deal tickets (reverse the extras)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.duplicates.map((r) => (
                    <tr key={r.reference} className="border-b border-line/40 align-top last:border-0">
                      <td className="px-4 py-3 font-mono text-xs text-ink">{r.reference}</td>
                      <td className="px-4 py-3 font-mono text-ink">{r.login}</td>
                      <td className="px-4 py-3 text-ink">
                        {r.amount.toFixed(2)} <span className="text-ink-dim">{r.currency}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-danger/25 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                          {r.count}× (+{r.extraCount})
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-danger">
                        {r.extraAmount.toFixed(2)} {r.currency}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">{r.tickets.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-dim">
            Keep one deal per reference; reverse the extra deal tickets in MT5 (balance withdrawal of the same amount).
          </p>
        </>
      )}
    </div>
  );
}
