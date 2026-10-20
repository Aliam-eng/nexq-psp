"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/ui";

const TERMINAL = ["CREDITED", "FAILED", "CREDIT_FAILED"];

export function ReturnStatus(props: {
  txId: string;
  reference: string;
  amount: number;
  currency: string;
  mt5Login: string;
  initialStatus: string;
  method?: string;
}) {
  const usdt = props.method === "USDT_TRC20";
  const rail = usdt ? "USDT" : "Whish";
  const [status, setStatus] = useState(props.initialStatus);
  const [deal, setDeal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const inFlight = useRef(false);

  const sync = useCallback(async () => {
    if (inFlight.current) return; // don't overlap requests
    inFlight.current = true;
    try {
      const res = await fetch(`/api/deposits/${props.txId}/sync`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.status) setStatus(data.status);
      if (data.mt5DealId) setDeal(data.mt5DealId);
      if (data.errorMessage) setErr(data.errorMessage);
      if (data.status && TERMINAL.includes(data.status)) setPolling(false);
    } finally {
      inFlight.current = false;
    }
  }, [props.txId]);

  useEffect(() => {
    sync();
    if (!polling) return;
    const t = setInterval(sync, 4000);
    return () => clearInterval(t);
  }, [sync, polling]);

  const success = status === "CREDITED";
  const failed = status === "FAILED";
  const creditFailed = status === "CREDIT_FAILED";
  const pending = !success && !failed && !creditFailed;

  const heading = success
    ? "You're funded"
    : creditFailed
    ? "Payment received"
    : failed
    ? "Deposit not completed"
    : status === "PAID"
    ? "Paid — crediting your account"
    : usdt
    ? "Waiting for your USDT"
    : "Waiting for Whish";

  // Friendly copy only — raw provider/MT5 errors stay in the back office.
  const message = success
    ? "The funds are in your MT5 account and ready to trade."
    : creditFailed
    ? "We've got your payment. Your account will be credited shortly — our team is already on it, no action needed."
    : failed
    ? err && /expired/i.test(err)
      ? "The payment link expired before it was paid. No money was taken — start a new deposit any time."
      : "The payment wasn't completed. You can start a new deposit at any time."
    : status === "PAID"
    ? `${usdt ? "Your USDT payment is confirmed" : "Whish confirmed your payment"}. We're adding it to your MT5 account now.`
    : usdt
    ? "Send the exact amount on the TRON (TRC20) network to the address shown on the payment page. This page updates once it's confirmed on-chain."
    : "Approve the payment in the Whish app. This page updates on its own — no need to refresh.";

  // Progress timeline: link → paid → credited.
  const paidReached = ["PAID", "CREDITED", "CREDIT_FAILED"].includes(status);
  const steps: { label: string; state: "done" | "active" | "todo" | "error" }[] = [
    { label: "Payment link created", state: "done" },
    { label: `Paid with ${rail}`, state: paidReached ? "done" : failed ? "error" : "active" },
    {
      label: "Credited to MT5",
      state: success ? "done" : creditFailed ? "error" : status === "PAID" ? "active" : "todo",
    },
  ];

  return (
    <div className="card overflow-hidden">
      <div className={`px-6 pb-6 pt-7 ${success ? "bg-emerald-50" : failed ? "bg-rose-50" : creditFailed ? "bg-orange-50" : "bg-surface-raised"}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-dim">Deposit {props.reference}</p>
            <p className="mt-2 text-3xl font-extrabold tabular-nums text-ink">
              {props.amount.toFixed(2)} <span className="text-lg font-bold text-ink-muted">{props.currency}</span>
            </p>
          </div>
          <StatusBadge status={status} />
        </div>
        <h2 className="mt-5 text-lg font-extrabold text-ink">{heading}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{message}</p>
      </div>

      <ol className="space-y-0 px-6 py-5">
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span className={`absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5 ${s.state === "done" ? "bg-brand" : "bg-line"}`} />
            )}
            <StepDot state={s.state} />
            <span className={`pt-0.5 text-sm font-semibold ${s.state === "todo" ? "text-ink-dim" : "text-ink"}`}>{s.label}</span>
          </li>
        ))}
      </ol>

      <dl className="grid grid-cols-2 gap-4 border-t border-line px-6 py-4 text-sm">
        <div>
          <dt className="text-xs text-ink-dim">MT5 account</dt>
          <dd className="mt-0.5 font-mono font-semibold text-ink">{props.mt5Login}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-dim">Deal ID</dt>
          <dd className="mt-0.5 font-mono font-semibold text-ink">{deal || "—"}</dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-raised px-6 py-4">
        <span className="text-xs text-ink-dim">
          {pending ? "Checking every few seconds…" : `Save ${props.reference} as your receipt`}
        </span>
        <Link href="/deposit" className="btn-ghost px-4 py-1.5 text-xs">
          Deposit again →
        </Link>
      </div>
    </div>
  );
}

function StepDot({ state }: { state: "done" | "active" | "todo" | "error" }) {
  if (state === "done")
    return (
      <span className="bg-brand-gradient relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-white">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 13 4 4L19 7" />
        </svg>
      </span>
    );
  if (state === "error")
    return (
      <span className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-danger text-white">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </span>
    );
  if (state === "active")
    return (
      <span className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-brand bg-white">
        <span className="h-2 w-2 animate-pulse-soft rounded-full bg-brand" />
      </span>
    );
  return <span className="relative z-10 h-6 w-6 shrink-0 rounded-full border-2 border-line bg-white" />;
}
