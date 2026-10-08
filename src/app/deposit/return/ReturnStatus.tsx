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
}) {
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
    : "Waiting for Whish";

  const message = success
    ? "The funds are now in your MT5 account and ready to trade."
    : creditFailed
    ? "We've got your payment. Your account will be credited shortly — our team is already on it, no action needed."
    : failed
    ? err || "The payment wasn't completed. You can start a new deposit at any time."
    : "Approve the payment in Whish. This page updates on its own — no need to refresh.";

  return (
    <div className="card overflow-hidden">
      {/* Hero state */}
      <div className="bg-brand-gradient h-1" />
      <div className="flex flex-col items-center border-b border-line/70 px-6 py-9 text-center">
        <StateIcon success={success} failed={failed} warn={creditFailed} />
        <h2 className="mt-4 text-xl font-bold text-ink">{heading}</h2>
        <p className="mt-1 max-w-xs text-sm text-ink-muted">{message}</p>
        <div className="mt-4">
          <StatusBadge status={status} />
        </div>
      </div>

      {/* Details */}
      <dl className="grid grid-cols-2 gap-px bg-line/60">
        <Detail label="Reference" value={props.reference} mono />
        <Detail label="MT5 account" value={props.mt5Login} mono />
        <Detail label="Amount" value={`${props.amount.toFixed(2)} ${props.currency}`} />
        <Detail label="Deal ID" value={deal || "—"} mono />
      </dl>

      <div className="flex items-center justify-between gap-3 px-6 py-4">
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

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-surface/70 px-6 py-4">
      <dt className="text-xs text-ink-dim">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function StateIcon({ success, failed, warn }: { success: boolean; failed: boolean; warn?: boolean }) {
  if (warn)
    return (
      <span className="grid h-14 w-14 place-items-center rounded-full border border-orange-400/30 bg-orange-400/10 text-orange-300">
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      </span>
    );
  if (success)
    return (
      <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-gradient text-white shadow-glow">
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 13 4 4L19 7" />
        </svg>
      </span>
    );
  if (failed)
    return (
      <span className="grid h-14 w-14 place-items-center rounded-full border border-danger/30 bg-danger/10 text-danger">
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </span>
    );
  return (
    <span className="grid h-14 w-14 place-items-center rounded-full border border-line bg-surface-raised/60">
      <svg className="h-7 w-7 animate-spin text-brand-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" />
        <path className="opacity-90" fill="currentColor" d="M12 3a9 9 0 0 1 9 9h-2.5A6.5 6.5 0 0 0 12 5.5V3z" />
      </svg>
    </span>
  );
}
