"use client";

import { useRef, useState } from "react";

export type DepositMethod = { key: "WHISH" | "USDT_TRC20"; min: number };

const METHOD_INFO = {
  WHISH: { label: "Whish Pay", sub: "Pay from your Whish wallet", unit: "USD", via: "Whish" },
  USDT_TRC20: { label: "USDT", sub: "TRC20 network", unit: "USDT", via: "USDT" },
} as const;

export function DepositForm({ methods }: { methods: DepositMethod[] }) {
  const [method, setMethod] = useState<DepositMethod["key"]>(methods[0]?.key ?? "WHISH");
  const [mt5Login, setMt5Login] = useState("");
  const [amount, setAmount] = useState("");
  const selected = methods.find((m) => m.key === method) ?? methods[0];
  const minDeposit = selected?.min ?? 0;
  const info = METHOD_INFO[method];
  const currency = info.unit; // MT5 accounts are USD; 1 USDT is credited as 1 USD
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false); // guards against double-submit

  // Live minimum-deposit validation.
  const numeric = parseFloat(amount);
  const belowMin = minDeposit > 0 && amount !== "" && (Number.isNaN(numeric) || numeric < minDeposit);
  const minLabel = `Minimum deposit is ${minDeposit.toFixed(2)} ${currency}`;

  const validAmount = !Number.isNaN(numeric) && numeric > 0 && !belowMin;

  // Validate, then create the payment and hand off to Whish Pay.
  // A ref guard ensures one submit even on rapid double-clicks (no stray links).
  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    if (!mt5Login) {
      setError("Please enter your MT5 account number");
      return;
    }
    if (Number.isNaN(numeric) || numeric <= 0) {
      setError("Please enter a valid amount");
      return;
    }
    if (belowMin) {
      setError(minLabel);
      return;
    }
    submitting.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mt5Login, amount, currency: "USD", method }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.collectUrl) {
        submitting.current = false;
        setLoading(false);
        setError(data.error || "We couldn't start the payment. Please try again.");
        return;
      }
      // Success — navigating away to Whish / 3Pay; keep the guard locked.
      window.location.href = data.collectUrl;
    } catch {
      submitting.current = false;
      setLoading(false);
      setError("Connection lost. Check your internet and try again.");
    }
  }

  const quickAmounts = [100, 250, 500, 1000].filter((v) => v >= minDeposit);
  if (methods.length === 0) {
    return (
      <div className="card p-6 sm:p-7">
        <h2 className="text-lg font-extrabold text-ink">Deposits are paused</h2>
        <p className="mt-1 text-sm text-ink-muted">We&apos;re not accepting deposits right now. Please check back soon.</p>
      </div>
    );
  }
  return (
    <form onSubmit={pay} className="card overflow-hidden">
      <div className="bg-brand-gradient h-1" />
      <div className="space-y-6 p-6 sm:p-7">
        <div>
          <h2 className="text-lg font-extrabold text-ink">New deposit</h2>
          <p className="text-sm text-ink-muted">Credited to your MT5 account in USD.</p>
        </div>

        {methods.length > 1 && (
          <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-2">
            {methods.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={method === m.key}
                onClick={() => {
                  setMethod(m.key);
                  setError(null);
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  method === m.key ? "border-brand bg-brand/10" : "border-line bg-white hover:border-line-strong"
                }`}
              >
                <span className="block text-sm font-bold text-ink">{METHOD_INFO[m.key].label}</span>
                <span className="block text-xs text-ink-muted">{METHOD_INFO[m.key].sub}</span>
              </button>
            ))}
          </div>
        )}

        {/* Amount — the headline figure */}
        <div>
          <label htmlFor="amount" className="field-label">How much?</label>
          <div
            className={`flex items-baseline gap-2 rounded-2xl border-2 bg-surface-raised px-4 py-3 transition focus-within:border-brand focus-within:bg-white ${
              belowMin ? "border-danger/60" : "border-line"
            }`}
          >
            <span className="text-2xl font-bold text-ink-dim">$</span>
            <input
              id="amount"
              type="number"
              min={minDeposit > 0 ? minDeposit : 0.01}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={belowMin}
              className="w-full min-w-0 bg-transparent text-3xl font-extrabold tabular-nums text-ink outline-none"
            />
            <span className="text-sm font-bold text-ink-dim">{currency}</span>
          </div>
          {quickAmounts.length > 0 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {quickAmounts.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(v.toFixed(2))}
                  className={`rounded-xl border py-2 text-sm font-bold transition ${
                    numeric === v
                      ? "border-brand bg-brand/10 text-brand-400"
                      : "border-line bg-white text-ink-muted hover:border-line-strong hover:text-ink"
                  }`}
                >
                  ${v.toLocaleString("en-US")}
                </button>
              ))}
            </div>
          )}
          {belowMin ? (
            <span className="mt-2 block text-xs font-medium text-danger">{minLabel}</span>
          ) : minDeposit > 0 ? (
            <span className="field-hint">
              Minimum {minDeposit.toFixed(2)} {currency}
            </span>
          ) : null}
        </div>

        <div>
          <label htmlFor="mt5" className="field-label">MT5 account number</label>
          <input
            id="mt5"
            inputMode="numeric"
            required
            value={mt5Login}
            onChange={(e) => setMt5Login(e.target.value.replace(/[^0-9]/g, ""))}
            className="field-input font-mono text-base tracking-wider"
          />
          <span className="field-hint">You&apos;ll find it in your nexQ welcome email or MT5 terminal.</span>
        </div>

        {validAmount && mt5Login && method === "WHISH" && (
          <div className="flex justify-between rounded-xl bg-surface-raised px-4 py-3 text-sm">
            <span className="text-ink-muted">Credited to {mt5Login}</span>
            <span className="font-semibold tabular-nums text-ink">{numeric.toFixed(2)} USD</span>
          </div>
        )}
        {method === "USDT_TRC20" && (
          <p className="rounded-xl bg-surface-raised px-4 py-3 text-xs leading-relaxed text-ink-muted">
            Send <strong className="text-ink">USDT on the TRON (TRC20) network only</strong> to the address shown on the next page.
            Your MT5 account is credited 1 USD per USDT received, after the processing fee.
          </p>
        )}

        {error && (
          <p className="rounded-xl border border-danger/30 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-danger">{error}</p>
        )}

        <button type="submit" disabled={belowMin || loading} className="btn-primary w-full py-3.5 text-[15px]">
          {loading ? (
            <>
              <Spinner /> {method === "WHISH" ? "Connecting to Whish…" : "Preparing your USDT payment…"}
            </>
          ) : validAmount ? (
            method === "WHISH" ? `Pay ${numeric.toFixed(2)} USD with Whish →` : `Pay ${numeric.toFixed(2)} USDT →`
          ) : (
            `Pay with ${info.via} →`
          )}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-xs text-ink-dim">
          <LockIcon />{" "}
          {method === "WHISH" ? <>Secured by Whish Pay · you&apos;ll confirm in the Whish app</> : <>Credited automatically once confirmed on-chain</>}
        </p>
      </div>
    </form>
  );
}

function LockIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
    </svg>
  );
}
