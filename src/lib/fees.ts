// Deposit fee calculation — single source of truth used by both the client
// form (live display) and the server (authoritative, stored on the transaction).
//
// Currently returns 0. Later, compute the fee based on the amount here — e.g.
// a percentage, a flat fee, or tiered brackets. Everything downstream (the
// "Total to pay", the Whish charge, the stored `fee`) updates automatically.
export function computeFee(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  // TODO: fee logic goes here. Example: return round2(amount * 0.02);
  return 0;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// The client pays amount + fee via Whish; the MT5 account is credited `amount`.
export function computeTotal(amount: number): number {
  return round2(amount + computeFee(amount));
}
