"use client";

import { useRef, useState } from "react";
import { computeFee, round2 } from "@/lib/fees";

export function DepositForm({ minDeposit = 0 }: { minDeposit?: number }) {
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [mt5Login, setMt5Login] = useState("");
  const [amount, setAmount] = useState("");
  const currency = "USD"; // Whish is USD-only per Rival docs
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false); // guards against double-submit

  // Live minimum-deposit validation.
  const numeric = parseFloat(amount);
  const belowMin = minDeposit > 0 && amount !== "" && (Number.isNaN(numeric) || numeric < minDeposit);
  const minLabel = `Minimum deposit is ${minDeposit.toFixed(2)} ${currency}`;

  // Fee (0 for now) and total the client pays. See src/lib/fees.ts.
  const validAmount = !Number.isNaN(numeric) && numeric > 0 && !belowMin;
  const fee = validAmount ? computeFee(numeric) : 0;
  const total = validAmount ? round2(numeric + fee) : 0;

  // Step 1 → review. Validate before showing the confirmation.
  function proceed(e: React.FormEvent) {
    e.preventDefault();
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
    setStep("confirm");
  }

  // Step 2 → create the payment and hand off to Whish Pay.
  // A ref guard ensures one submit even on rapid double-clicks (no stray links).
  async function confirmPay() {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mt5Login, amount, currency, email }),
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

  // ---------------- Step 2: confirmation receipt ----------------
  if (step === "confirm") {
    return (
      <div className="card animate-fade-up overflow-hidden">
        <Stepper current={2} />
        <div className="p-6 sm:p-7">
          <h2 className="text-lg font-bold text-ink">Deposit summary</h2>
          <p className="mt-1 text-sm text-ink-muted">One last look before we hand you over to Whish.</p>

          <div className="mt-5 rounded-2xl bg-surface-raised/70 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-dim">Crediting account</p>
            <p className="mt-1 font-mono text-2xl font-semibold tracking-wide text-ink">{mt5Login}</p>
            <div className="mt-5 space-y-3 border-t border-line pt-4">
              <LedgerRow label="Deposit">
                <span className="tabular-nums text-ink">
                  {numeric.toFixed(2)} {currency}
                </span>
              </LedgerRow>
              <LedgerRow label="Processing fee">
                <span className="tabular-nums text-ink">{fee > 0 ? `${fee.toFixed(2)} ${currency}` : "Free"}</span>
              </LedgerRow>
              <div className="border-t border-line pt-3">
                <LedgerRow label={<span className="font-semibold text-ink">You pay</span>}>
                  <span className="text-xl font-bold tabular-nums text-ink">
                    {total.toFixed(2)} <span className="text-sm font-semibold text-ink-muted">{currency}</span>
                  </span>
                </LedgerRow>
              </div>
            </div>
          </div>

          <p className="mt-4 flex items-start gap-2 rounded-xl border border-gold/25 bg-gold/10 px-3.5 py-2.5 text-[13px] text-gold">
            <AlertIcon />
            <span>
              Deposits can&apos;t be redirected once paid. Confirm that <strong>{mt5Login}</strong> is your account.
            </span>
          </p>

          {error && (
            <p className="mt-3 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setError(null);
              }}
              disabled={loading}
              className="btn-ghost"
            >
              ← Back
            </button>
            <button type="button" onClick={confirmPay} disabled={loading} className="btn-primary flex-1">
              {loading ? (
                <>
                  <Spinner /> Connecting to Whish…
                </>
              ) : (
                "Pay with Whish →"
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Step 1: details form ----------------
  const quickAmounts = [100, 250, 500, 1000].filter((v) => v >= minDeposit);
  return (
    <form onSubmit={proceed} className="card overflow-hidden">
      <Stepper current={1} />
      <div className="space-y-5 p-6 sm:p-7">
        <div>
          <label className="field-label">MT5 account number</label>
          <input
            inputMode="numeric"
            required
            value={mt5Login}
            onChange={(e) => setMt5Login(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="e.g. 5000123"
            className="field-input font-mono tracking-wide"
          />
          <span className="field-hint">You&apos;ll find it in your nexQ welcome email or MT5 terminal.</span>
        </div>

        <div>
          <label className="field-label">Deposit amount</label>
          <div className="relative">
            <input
              type="number"
              min={minDeposit > 0 ? minDeposit : 0.01}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={minDeposit > 0 ? minDeposit.toFixed(2) : "250.00"}
              aria-invalid={belowMin}
              className={`field-input pr-14 font-mono text-base ${belowMin ? "border-danger/60 focus:border-danger/60" : ""}`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs font-semibold text-ink-dim">
              {currency}
            </span>
          </div>
          {quickAmounts.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {quickAmounts.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(v.toFixed(2))}
                  className={`chip ${numeric === v ? "chip-active" : ""}`}
                >
                  ${v.toLocaleString("en-US")}
                </button>
              ))}
            </div>
          )}
          {belowMin ? (
            <span className="mt-1.5 block text-xs text-danger">{minLabel}</span>
          ) : minDeposit > 0 ? (
            <span className="field-hint">
              Minimum {minDeposit.toFixed(2)} {currency}
            </span>
          ) : null}
        </div>

        <div>
          <label className="field-label">
            Email <span className="font-normal text-ink-dim">· optional</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="field-input"
          />
          <span className="field-hint">We&apos;ll send your deposit confirmation here.</span>
        </div>

        {error && (
          <p className="rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{error}</p>
        )}

        <button type="submit" disabled={belowMin} className="btn-primary w-full py-3">
          Review deposit →
        </button>
        <p className="flex items-center justify-center gap-1.5 text-xs text-ink-dim">
          <LockIcon /> Payments are handled securely by Whish Pay
        </p>
      </div>
    </form>
  );
}

function Stepper({ current }: { current: 1 | 2 }) {
  const steps = ["Details", "Review", "Pay"];
  return (
    <div className="flex items-center gap-2 border-b border-line/70 bg-surface-raised/40 px-6 py-3.5 sm:px-7">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <div key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <span
              className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
                active || done ? "bg-brand-gradient text-white" : "border border-line-strong text-ink-dim"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={`text-xs font-semibold ${active ? "text-ink" : "text-ink-dim"}`}>{label}</span>
            {n < steps.length && <span className={`h-px flex-1 ${done ? "bg-brand/60" : "bg-line-strong"}`} />}
          </div>
        );
      })}
    </div>
  );
}

function LedgerRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="-translate-y-0.5 flex-1 border-b border-dotted border-line-strong" />
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

function AlertIcon() {
  return (
    <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
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
