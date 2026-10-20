"use client";

import { useRef, useState } from "react";

// Match MIN_WITHDRAWAL / MIN_USDT_WITHDRAWAL and TRC20_PAYOUT_FEE on the server.
const MIN = { WHISH: 1, USDT_TRC20: 3 } as const;
const USDT_FEE = 2;
const TRC20 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
type Method = keyof typeof MIN;

export function WithdrawForm({ methods }: { methods: Method[] }) {
  const [method, setMethod] = useState<Method>(methods[0] ?? "WHISH");
  const [mt5Login, setMt5Login] = useState("");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ reference: string; amount: number } | null>(null);
  const submitting = useRef(false);

  const numeric = parseFloat(amount);
  const usdt = method === "USDT_TRC20";
  const min = MIN[method];
  const unit = usdt ? "USDT" : "USD";
  const validAmount = !Number.isNaN(numeric) && numeric >= min;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    if (!mt5Login) return setError("Please enter your MT5 account number");
    if (!validAmount) return setError(`Minimum withdrawal is ${min.toFixed(2)} ${unit}`);
    if (usdt && !TRC20.test(wallet.trim())) return setError("Please enter a valid USDT TRC20 address (starts with T)");
    if (!usdt && phone.replace(/\D/g, "").length < 8) return setError("Please enter your Whish phone number");

    submitting.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(usdt ? { mt5Login, amount, method, walletAddress: wallet.trim() } : { mt5Login, amount, method, phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "We couldn't submit your request. Please try again.");
        return;
      }
      setDone({ reference: data.reference, amount: data.amount });
    } catch {
      setError("Connection lost. Check your internet and try again.");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  if (methods.length === 0) {
    return (
      <div className="card p-6 sm:p-7">
        <h2 className="text-lg font-extrabold text-ink">Withdrawals are paused</h2>
        <p className="mt-1 text-sm text-ink-muted">We&apos;re not taking withdrawal requests right now. Please check back soon.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card overflow-hidden">
        <div className="bg-brand-gradient h-1" />
        <div className="p-6 sm:p-7">
          <span className="bg-brand-gradient grid h-12 w-12 place-items-center rounded-full text-white">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </span>
          <h2 className="mt-4 text-lg font-extrabold text-ink">Request received</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            We&apos;ll review your withdrawal of <strong className="text-ink">{done.amount.toFixed(2)} USD</strong> from MT5
            account <strong className="text-ink">{mt5Login}</strong> and send it to your {usdt ? "USDT (TRC20) address" : "Whish wallet"}.
          </p>
          <div className="mt-5 rounded-xl bg-surface-raised px-4 py-3">
            <p className="text-xs text-ink-dim">Your reference</p>
            <p className="mt-0.5 font-mono text-lg font-bold text-ink">{done.reference}</p>
          </div>
          <p className="mt-3 text-xs text-ink-dim">Keep this reference in case you need to contact us.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card overflow-hidden">
      <div className="bg-brand-gradient h-1" />
      <div className="space-y-6 p-6 sm:p-7">
        <div>
          <h2 className="text-lg font-extrabold text-ink">New withdrawal</h2>
          <p className="text-sm text-ink-muted">Reviewed by our team before any money moves.</p>
        </div>

        {methods.length > 1 && (
          <div role="radiogroup" aria-label="Payout method" className="grid grid-cols-2 gap-2">
            {(
              [
                { key: "WHISH", label: "Whish", sub: "To your Whish wallet" },
                { key: "USDT_TRC20", label: "USDT", sub: "TRC20 address" },
              ] as const
            ).filter((m) => methods.includes(m.key)).map((m) => (
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
                <span className="block text-sm font-bold text-ink">{m.label}</span>
                <span className="block text-xs text-ink-muted">{m.sub}</span>
              </button>
            ))}
          </div>
        )}

        <div>
          <label htmlFor="w-amount" className="field-label">How much?</label>
          <div className="flex items-baseline gap-2 rounded-2xl border-2 border-line bg-surface-raised px-4 py-3 transition focus-within:border-brand focus-within:bg-white">
            <span className="text-2xl font-bold text-ink-dim">$</span>
            <input
              id="w-amount"
              type="number"
              min={min}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full min-w-0 bg-transparent text-3xl font-extrabold tabular-nums text-ink outline-none"
            />
            <span className="text-sm font-bold text-ink-dim">{unit}</span>
          </div>
          <span className="field-hint">
            Must be covered by your account&apos;s free margin.
            {usdt && validAmount && (
              <>
                {" "}You receive <strong className="text-ink">{(numeric - USDT_FEE).toFixed(2)} USDT</strong> after the {USDT_FEE} USDT
                network fee.
              </>
            )}
            {usdt && !validAmount && <> Minimum {min.toFixed(2)} USDT · {USDT_FEE} USDT network fee is deducted.</>}
          </span>
        </div>

        <div>
          <label htmlFor="w-mt5" className="field-label">MT5 account number</label>
          <input
            id="w-mt5"
            inputMode="numeric"
            required
            value={mt5Login}
            onChange={(e) => setMt5Login(e.target.value.replace(/[^0-9]/g, ""))}
            className="field-input font-mono text-base tracking-wider"
          />
        </div>

        {usdt ? (
          <div>
            <label htmlFor="w-wallet" className="field-label">USDT address (TRC20)</label>
            <input
              id="w-wallet"
              required
              spellCheck={false}
              autoComplete="off"
              value={wallet}
              onChange={(e) => setWallet(e.target.value.trim())}
              className="field-input font-mono text-sm"
            />
            <span className="field-hint">TRON network only — starts with T. Sending to the wrong network loses the funds.</span>
          </div>
        ) : (
        <div>
          <label htmlFor="w-phone" className="field-label">Whish phone number</label>
          <input
            id="w-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s-]/g, ""))}
            className="field-input font-mono text-base tracking-wider"
          />
          <span className="field-hint">The Whish account we&apos;ll send the money to, e.g. +961 70 123 456.</span>
        </div>
        )}

        {error && (
          <p className="rounded-xl border border-danger/30 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-danger">{error}</p>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 text-[15px]">
          {loading ? "Sending request…" : validAmount ? `Request ${numeric.toFixed(2)} ${unit} →` : "Request withdrawal →"}
        </button>
      </div>
    </form>
  );
}
