"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { WithdrawalBadge } from "@/components/ui";

type Row = {
  id: string;
  reference: string;
  mt5Login: string;
  amount: number;
  currency: string;
  method: string;
  phone: string | null;
  walletAddress: string | null;
  payoutTxHash: string | null;
  payoutNet: number | null;
  payoutError: string | null;
  refundDealId: string | null;
  status: string;
  rejectionReason: string | null;
  errorMessage: string | null;
  mt5DealId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

const USDT_FEE = 2; // TRC20 payout fee charged by 3Pay, deducted from the amount

const TABS: { key: string; label: string; statuses: string[] | null }[] = [
  { key: "pending", label: "Pending review", statuses: ["PENDING"] },
  { key: "attention", label: "Needs attention", statuses: ["FAILED", "PAYOUT_FAILED", "PAYOUT_UNKNOWN"] },
  { key: "progress", label: "In progress", statuses: ["PROCESSING", "PAYOUT_PENDING"] },
  { key: "done", label: "Completed", statuses: ["COMPLETED"] },
  { key: "closed", label: "Rejected / refunded", statuses: ["REJECTED", "REFUNDED"] },
  { key: "all", label: "All", statuses: null },
];

const QUICK_REASONS = [
  "Insufficient free margin",
  "Details don't match our records",
  "Duplicate request",
  "Open positions — please close first",
];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s);
const isUsdt = (r: Row) => r.method === "USDT_TRC20";

type Dialog = { kind: "approve" | "reject" | "refund" | "retry"; row: Row } | null;

export function WithdrawalsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [tab, setTab] = useState("pending");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

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
        (!q || [r.reference, r.mt5Login, r.phone ?? "", r.walletAddress ?? "", r.decidedBy ?? ""].some((v) => v.toLowerCase().includes(q)))
    );
  }, [rows, tab, query]);

  async function checkPayout(r: Row) {
    setBusy(r.id);
    setNotice(null);
    const res = await fetch(`/api/admin/withdrawals/${r.id}/payout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    setNotice(res.ok ? { ok: true, text: `${r.reference}: ${String(data.status).toLowerCase().replace(/_/g, " ")}` } : { ok: false, text: data.error || "Check failed" });
    router.refresh();
  }

  const done = () => {
    setDialog(null);
    router.refresh();
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-5">
        <div className="relative min-w-[220px] flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search by reference, MT5 account, phone, wallet or staff email"
            className="w-full rounded-full border border-line bg-surface-raised py-2 pl-9 pr-4 text-sm text-ink outline-none transition focus:border-brand focus:bg-white focus:shadow-focus"
          />
        </div>
      </div>

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
            <span className={`rounded-full px-1.5 py-px text-[11px] tabular-nums ${tab === t.key ? "bg-ink text-white" : "bg-surface-overlay text-ink-muted"}`}>
              {counts[t.key]}
            </span>
            {tab === t.key && <span className="bg-brand-gradient absolute inset-x-0 -bottom-px h-0.5 rounded-full" />}
          </button>
        ))}
      </div>

      {notice && (
        <p className={`border-b border-line px-5 py-2.5 text-sm font-medium ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-danger"}`}>{notice.text}</p>
      )}

      {filtered.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-sm font-semibold text-ink">{query ? "No matches" : "Nothing here"}</p>
          <p className="mt-1 text-sm text-ink-muted">{query ? "Try a reference, account, phone or wallet." : "New requests will appear here."}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {filtered.map((r) => (
            <li key={r.id} className="grid gap-3 px-4 py-4 transition hover:bg-surface-raised md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,1.6fr)_232px] md:items-start md:gap-5 md:px-5">
              <div>
                <p className="font-mono text-[13px] font-semibold text-ink">{r.reference}</p>
                <p className="mt-0.5 text-xs text-ink-dim" suppressHydrationWarning>
                  {when(r.createdAt)}
                </p>
              </div>
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-2">
                  <span className="font-mono text-ink">MT5 {r.mt5Login}</span>
                  <span className={`rounded px-1.5 py-px text-[10px] font-bold uppercase ${isUsdt(r) ? "bg-teal-100 text-teal-800" : "bg-surface-overlay text-ink-muted"}`}>
                    {isUsdt(r) ? "USDT" : "Whish"}
                  </span>
                </p>
                {isUsdt(r) ? (
                  <button
                    type="button"
                    title={`Copy ${r.walletAddress}`}
                    onClick={() => navigator.clipboard?.writeText(r.walletAddress ?? "")}
                    className="mt-0.5 font-mono text-xs text-ink-muted hover:text-brand-400"
                  >
                    {short(r.walletAddress ?? "")} ⧉
                  </button>
                ) : (
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">{r.phone}</p>
                )}
              </div>
              <p className="whitespace-nowrap text-sm md:text-right">
                <span className="text-base font-bold tabular-nums text-ink">{r.amount.toFixed(2)}</span>{" "}
                <span className="text-xs text-ink-dim">{isUsdt(r) ? "USDT" : r.currency}</span>
              </p>
              <div className="min-w-0 text-xs">
                <WithdrawalBadge status={r.status} />
                {(r.status === "REJECTED" || r.status === "REFUNDED") && r.rejectionReason && (
                  <p className="mt-1 text-ink-muted">
                    <span className="font-semibold text-ink">Reason:</span> {r.rejectionReason}
                  </p>
                )}
                {r.status === "FAILED" && r.errorMessage && <p className="mt-1 truncate text-danger" title={r.errorMessage}>{r.errorMessage}</p>}
                {(r.status === "PAYOUT_FAILED" || r.status === "PAYOUT_UNKNOWN") && r.payoutError && (
                  <p className="mt-1 text-danger" title={r.payoutError}>
                    {r.payoutError}
                  </p>
                )}
                {r.status === "PAYOUT_UNKNOWN" && <p className="mt-1 font-semibold text-ink">Deducted from MT5 — check 3Pay before anything else.</p>}
                {r.status === "PAYOUT_FAILED" && <p className="mt-1 text-ink-muted">Deducted from MT5, nothing sent. Retry the payout or refund.</p>}
                {r.mt5DealId && <p className="mt-1 font-mono text-ink-muted">MT5 deal {r.mt5DealId}</p>}
                {r.refundDealId && <p className="mt-1 font-mono text-ink-muted">Refund deal {r.refundDealId}</p>}
                {r.payoutTxHash && (
                  <a
                    href={`https://tronscan.org/#/transaction/${r.payoutTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block font-mono text-brand-400 hover:underline"
                  >
                    Tx {short(r.payoutTxHash)} ↗ {r.payoutNet != null && <span className="text-ink-muted">· {r.payoutNet.toFixed(2)} USDT received</span>}
                  </a>
                )}
                {r.decidedBy && r.decidedAt && (
                  <p className="mt-1 text-ink-dim" suppressHydrationWarning>
                    by {r.decidedBy} · {when(r.decidedAt)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                {(r.status === "PENDING" || r.status === "FAILED") && (
                  <>
                    <button onClick={() => setDialog({ kind: "approve", row: r })} className="btn-primary px-4 py-1.5 text-xs">
                      {r.status === "FAILED" ? "Retry" : "Approve"}
                    </button>
                    <button onClick={() => setDialog({ kind: "reject", row: r })} className="btn-ghost px-4 py-1.5 text-xs">
                      Reject
                    </button>
                  </>
                )}
                {r.status === "PAYOUT_FAILED" && (
                  <>
                    <button onClick={() => setDialog({ kind: "retry", row: r })} className="btn-primary px-4 py-1.5 text-xs">
                      Retry payout
                    </button>
                    <button onClick={() => setDialog({ kind: "refund", row: r })} className="btn-ghost px-4 py-1.5 text-xs">
                      Refund to MT5
                    </button>
                  </>
                )}
                {(r.status === "PAYOUT_PENDING" || r.status === "PAYOUT_UNKNOWN") && (
                  <button onClick={() => checkPayout(r)} disabled={busy === r.id} className="btn-ghost px-4 py-1.5 text-xs">
                    {busy === r.id ? "Checking…" : "Check 3Pay"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "approve" && <ApproveDialog row={dialog.row} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "reject" && <ReasonDialog row={dialog.row} mode="reject" onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "refund" && <ReasonDialog row={dialog.row} mode="refund" onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "retry" && <RetryDialog row={dialog.row} onClose={() => setDialog(null)} onDone={done} />}
    </section>
  );
}

// Rendered into <body> via a portal: the page's fade-in uses a CSS transform, which
// would otherwise trap this fixed overlay inside the table card.
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/60 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card w-full max-w-md overflow-hidden animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <div className="bg-brand-gradient h-1" />
        <div className="p-6">
          <h3 className="text-lg font-extrabold text-ink">{title}</h3>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Summary({ row }: { row: Row }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-surface-raised p-4 text-sm">
      <div>
        <dt className="text-xs text-ink-dim">Amount</dt>
        <dd className="font-bold tabular-nums text-ink">
          {row.amount.toFixed(2)} {isUsdt(row) ? "USDT" : row.currency}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-ink-dim">MT5 account</dt>
        <dd className="font-mono font-semibold text-ink">{row.mt5Login}</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-xs text-ink-dim">{isUsdt(row) ? "Send to USDT (TRC20) address" : "Pay to Whish number"}</dt>
        <dd className="break-all font-mono font-semibold text-ink">{isUsdt(row) ? row.walletAddress : row.phone}</dd>
      </div>
    </dl>
  );
}

const ErrorLine = ({ text }: { text: string | null }) =>
  text ? <p className="mt-3 rounded-xl border border-danger/30 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-danger">{text}</p> : null;

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, data: await res.json().catch(() => ({})) };
}

function ApproveDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usdt = isUsdt(row);

  async function approve() {
    setBusy(true);
    setError(null);
    const { res, data } = await post(`/api/admin/withdrawals/${row.id}/approve`);
    setBusy(false);
    if (res.ok) return onDone();
    setError(data.error || "Approval failed");
    if (res.status === 409 || res.status === 502) setTimeout(onDone, 3500); // status changed — refresh the list
  }

  return (
    <Dialog title={row.status === "FAILED" ? "Retry this withdrawal?" : "Approve this withdrawal?"} onClose={busy ? () => {} : onClose}>
      <Summary row={row} />
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
        This immediately deducts <strong>{row.amount.toFixed(2)} USD</strong> from MT5 account <strong>{row.mt5Login}</strong>
        {usdt ? (
          <>
            , then sends it through 3Pay. The client receives <strong>{(row.amount - USDT_FEE).toFixed(2)} USDT</strong> after the{" "}
            {USDT_FEE} USDT network fee.
          </>
        ) : (
          <>. Then send the payout to the client&apos;s Whish number manually.</>
        )}
      </p>
      <ErrorLine text={error} />
      <div className="mt-5 flex gap-3">
        <button onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
        <button onClick={approve} disabled={busy} className="btn-primary flex-1">
          {busy ? (usdt ? "Deducting & sending USDT…" : "Deducting from MT5…") : usdt ? `Approve & send ${row.amount.toFixed(2)}` : `Approve & deduct ${row.amount.toFixed(2)}`}
        </button>
      </div>
    </Dialog>
  );
}

function RetryDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    const { res, data } = await post(`/api/admin/withdrawals/${row.id}/payout`, { action: "retry" });
    setBusy(false);
    if (res.ok) return onDone();
    setError(data.error || "Retry failed");
    setTimeout(onDone, 3500);
  }

  return (
    <Dialog title="Send the USDT payout again?" onClose={busy ? () => {} : onClose}>
      <Summary row={row} />
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">
        MT5 was already deducted, so nothing is deducted again. This asks 3Pay to send{" "}
        <strong>{row.amount.toFixed(2)} USDT</strong> to the address above.
      </p>
      <ErrorLine text={error} />
      <div className="mt-5 flex gap-3">
        <button onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
        <button onClick={retry} disabled={busy} className="btn-primary flex-1">
          {busy ? "Sending USDT…" : "Retry payout"}
        </button>
      </div>
    </Dialog>
  );
}

function ReasonDialog({ row, mode, onClose, onDone }: { row: Row; mode: "reject" | "refund"; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= 3;
  const refund = mode === "refund";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setError("Please give a reason");
    setBusy(true);
    setError(null);
    const { res, data } = refund
      ? await post(`/api/admin/withdrawals/${row.id}/payout`, { action: "refund", reason })
      : await post(`/api/admin/withdrawals/${row.id}/reject`, { reason });
    setBusy(false);
    if (res.ok) return onDone();
    setError(data.error || (refund ? "Refund failed" : "Rejection failed"));
  }

  return (
    <Dialog title={refund ? "Refund to the MT5 account?" : "Reject this withdrawal?"} onClose={busy ? () => {} : onClose}>
      <Summary row={row} />
      {refund && (
        <p className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 text-[13px] text-violet-900">
          Credits <strong>{row.amount.toFixed(2)} USD</strong> back to MT5 account <strong>{row.mt5Login}</strong> and closes the
          request. Only do this if no USDT was sent.
        </p>
      )}
      <form onSubmit={submit} className="mt-4">
        <label htmlFor="reason" className="field-label">Reason <span className="font-normal text-ink-dim">· required, kept in the log</span></label>
        <textarea id="reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="field-input resize-none" autoFocus />
        {!refund && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((q) => (
              <button key={q} type="button" onClick={() => setReason(q)} className={`chip ${reason === q ? "chip-active" : ""}`}>
                {q}
              </button>
            ))}
          </div>
        )}
        <ErrorLine text={error} />
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || !valid} className={`btn flex-1 text-white hover:brightness-110 ${refund ? "bg-violet-600" : "bg-danger"}`}>
            {busy ? (refund ? "Refunding…" : "Rejecting…") : refund ? "Refund to MT5" : "Reject request"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
