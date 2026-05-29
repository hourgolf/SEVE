// Formatting helpers — mirror the reference HTML's money() / t2() / fmt() / d2().

export const money = (v: number | null | undefined): string =>
  v == null ? "—" : "$" + Number(v).toFixed(2);

// 24-hour local clock, e.g. "14:32:05"
export const timeOfDay = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour12: false });

// Price/greek cell value; "·" placeholder when the contract leg is missing.
export const num2 = (v: number | null | undefined): string =>
  v == null ? "·" : Number(v).toFixed(2);

// Whole-percent, e.g. 30 → "30%".
export const pct = (v: number | null | undefined): string =>
  v == null ? "—" : `${Math.round(Number(v))}%`;

// Whole-dollar with thousands separators, e.g. 10000 → "$10,000".
export const usd0 = (v: number | null | undefined): string =>
  v == null ? "—" : "$" + Math.round(Number(v)).toLocaleString();

// Signed whole-dollar P&L, e.g. 1234 → "+$1,234", -56 → "−$56".
export const signedUsd = (v: number | null | undefined): string => {
  if (v == null) return "—";
  const n = Number(v);
  const sign = n < 0 ? "−" : "+";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
};
