"use client";

import { useRef, useState } from "react";

export function DepositForm({ minDeposit = 0 }: { minDeposit?: number }) {
  const [mt5Login, setMt5Login] = useState("");
  const [amount, setAmount] = useState("");
  const currency = "USD"; // MT5 accounts are USD (Whish also supports LBP)
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
        body: JSON.stringify({ mt5Login, amount, currency }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.collectUrl) {
        submitting.current = false;
        setLoading(false);
        setError(data.error || "We couldn't start the payment. Please try again.");
        return;
      }
      // Success — navigating away to Whish; keep the guard locked.
      window.location.href = data.collectUrl;
    } catch {
      submitting.current = false;
      setLoading(false);
      setError("Connection lost. Check your internet and try again.");
    }
  }

  const quickAmounts = [100, 250, 500, 1000].filter((v) => v >= minDeposit);
  return (
    <form onSubmit={pay} className="card overflow-hidden">
      <div className="bg-brand-gradient h-1" />
      <div className="space-y-6 p-6 sm:p-7">
        <div>
          <h2 className="text-lg font-extrabold text-ink">New deposit</h2>
          <p className="text-sm text-ink-muted">Credited to your MT5 account in {currency}.</p>
        </div>

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

        {validAmount && mt5Login && (
          <div className="flex justify-between rounded-xl bg-surface-raised px-4 py-3 text-sm">
            <span className="text-ink-muted">Credited to {mt5Login}</span>
            <span className="font-semibold tabular-nums text-ink">{numeric.toFixed(2)} {currency}</span>
          </div>
        )}

        {error && (
          <p className="rounded-xl border border-danger/30 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-danger">{error}</p>
        )}

        <button type="submit" disabled={belowMin || loading} className="btn-primary w-full py-3.5 text-[15px]">
          {loading ? (
            <>
              <Spinner /> Connecting to Whish…
            </>
          ) : validAmount ? (
            `Pay ${numeric.toFixed(2)} ${currency} with Whish →`
          ) : (
            "Pay with Whish →"
          )}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-xs text-ink-dim">
          <LockIcon /> Secured by Whish Pay · you&apos;ll confirm in the Whish app
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
